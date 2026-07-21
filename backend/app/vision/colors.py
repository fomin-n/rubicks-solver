from __future__ import annotations

from itertools import permutations

import numpy as np
from scipy.optimize import linear_sum_assignment
from sklearn.cluster import KMeans

from app.cube.model import CORNER_FACELETS, FACE_ORDER, OPPOSITE_COLOR, Color, Face

from .processing import StickerSample

# Fixed display colors. Camera samples are never exposed as the recognized UI color.
CANONICAL_HEX: dict[Color, str] = {
    Color.RED: "#e84255",
    Color.BLUE: "#3e88e9",
    Color.ORANGE: "#f39b38",
    Color.WHITE: "#edf0e8",
    Color.GREEN: "#38bf83",
    Color.YELLOW: "#f1d54c",
}

# Median CIE Lab values measured from the six supplied photos after locating the
# black 2x2 body and sampling the center of each sticker. Lightness receives a
# smaller distance weight below so shadows and glossy highlights do not move a
# sticker into another physical color class.
REFERENCE_LAB = {
    Color.RED: np.array((35.9, 59.8, 38.5)),
    Color.ORANGE: np.array((51.1, 48.2, 56.2)),
    Color.WHITE: np.array((71.5, 0.2, 10.0)),
    Color.YELLOW: np.array((68.3, -0.5, 71.2)),
    Color.GREEN: np.array((47.2, -43.0, 31.0)),
    Color.BLUE: np.array((34.2, 7.0, -40.0)),
}
LAB_DISTANCE_WEIGHTS = np.array((0.45, 1.0, 1.0))


def _color_distances(values: np.ndarray, references: np.ndarray) -> np.ndarray:
    return np.linalg.norm(
        (values[:, None, :] - references[None, :, :]) * LAB_DISTANCE_WEIGHTS,
        axis=2,
    )


def classify_provisional(
    samples: tuple[StickerSample, StickerSample, StickerSample, StickerSample],
) -> tuple[list[Color], list[float]]:
    """Label one captured face for immediate feedback; global balancing remains authoritative."""
    colors = tuple(Color)
    references = np.array([REFERENCE_LAB[color] for color in colors])
    values = np.array([sample.lab for sample in samples], dtype=float)
    distances = _color_distances(values, references)
    labels: list[Color] = []
    confidence: list[float] = []
    for index, sample in enumerate(samples):
        order = np.argsort(distances[index])
        labels.append(colors[int(order[0])])
        margin = float(
            (distances[index, order[1]] - distances[index, order[0]])
            / max(distances[index, order[1]], 1.0)
        )
        consistency_penalty = min(0.3, sample.consistency / 120)
        confidence.append(round(max(0.0, min(1.0, margin - consistency_penalty)), 3))
    return labels, confidence


def _balanced_clusters(values: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    model = KMeans(n_clusters=6, random_state=42, n_init=20).fit(values)
    centroids = model.cluster_centers_
    assignment = np.zeros(len(values), dtype=np.int32)
    for _ in range(8):
        slots = np.repeat(centroids, 4, axis=0)
        costs = np.linalg.norm(values[:, None, :] - slots[None, :, :], axis=2)
        rows, columns = linear_sum_assignment(costs)
        next_assignment = np.zeros_like(assignment)
        next_assignment[rows] = columns // 4
        next_centroids = np.vstack(
            [values[next_assignment == cluster].mean(axis=0) for cluster in range(6)]
        )
        if np.array_equal(next_assignment, assignment):
            centroids = next_centroids
            break
        assignment, centroids = next_assignment, next_centroids
    return assignment, centroids


def _corner_cluster_sets(assignment: np.ndarray) -> list[set[int]]:
    offsets = {face: index * 4 for index, face in enumerate(FACE_ORDER)}
    return [
        {int(assignment[offsets[face] + index]) for face, index in keys} for keys in CORNER_FACELETS
    ]


def _label_clusters(assignment: np.ndarray, centroids: np.ndarray) -> dict[int, Color]:
    colors = tuple(Color)
    corner_sets = _corner_cluster_sets(assignment)
    best_score = float("inf")
    best: dict[int, Color] | None = None
    for candidate in permutations(colors):
        reference_cost = sum(
            float(
                np.linalg.norm((centroids[cluster] - REFERENCE_LAB[color]) * LAB_DISTANCE_WEIGHTS)
            )
            for cluster, color in enumerate(candidate)
        )
        opposite_penalty = 0.0
        for clusters in corner_sets:
            labels = {candidate[cluster] for cluster in clusters}
            if any(OPPOSITE_COLOR[color] in labels for color in labels):
                opposite_penalty += 500.0
        score = reference_cost + opposite_penalty
        if score < best_score:
            best_score = score
            best = {cluster: color for cluster, color in enumerate(candidate)}
    assert best is not None
    return best


def classify_samples(
    samples: dict[Face, tuple[StickerSample, StickerSample, StickerSample, StickerSample]],
) -> tuple[dict[Face, list[Color]], dict[Face, list[float]]]:
    ordered = [sample for face in FACE_ORDER for sample in samples[face]]
    values = np.array([sample.lab for sample in ordered], dtype=float)
    assignment, centroids = _balanced_clusters(values)
    labels = _label_clusters(assignment, centroids)
    distances = np.linalg.norm(values[:, None, :] - centroids[None, :, :], axis=2)

    facelets: dict[Face, list[Color]] = {}
    confidence: dict[Face, list[float]] = {}
    for face_index, face in enumerate(FACE_ORDER):
        facelets[face] = []
        confidence[face] = []
        for sticker_index in range(4):
            index = face_index * 4 + sticker_index
            cluster = int(assignment[index])
            facelets[face].append(labels[cluster])
            ranked = np.sort(distances[index])
            margin = float((ranked[1] - ranked[0]) / max(ranked[1], 1.0))
            consistency_penalty = min(0.3, ordered[index].consistency / 120)
            confidence[face].append(round(max(0.0, min(1.0, margin - consistency_penalty)), 3))
    return facelets, confidence
