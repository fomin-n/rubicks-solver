from __future__ import annotations

from itertools import permutations

import cv2
import numpy as np
from scipy.optimize import linear_sum_assignment
from sklearn.cluster import KMeans

from app.cube.model import CORNER_FACELETS, FACE_ORDER, OPPOSITE_COLOR, Color, Face

from .processing import StickerSample


def _rgb_to_lab(rgb: tuple[int, int, int]) -> np.ndarray:
    pixel = np.array([[rgb[::-1]]], dtype=np.uint8)
    lab = cv2.cvtColor(pixel, cv2.COLOR_BGR2LAB)[0, 0].astype(float)
    return np.array((lab[0] * 100 / 255, lab[1] - 128, lab[2] - 128))


REFERENCE_LAB = {
    Color.RED: _rgb_to_lab((200, 35, 45)),
    Color.ORANGE: _rgb_to_lab((245, 125, 30)),
    Color.WHITE: _rgb_to_lab((235, 235, 225)),
    Color.YELLOW: _rgb_to_lab((245, 215, 25)),
    Color.GREEN: _rgb_to_lab((25, 155, 80)),
    Color.BLUE: _rgb_to_lab((25, 90, 190)),
}


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
            float(np.linalg.norm(centroids[cluster] - REFERENCE_LAB[color]))
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
            consistency_penalty = min(0.5, ordered[index].consistency / 50)
            confidence[face].append(round(max(0.0, min(1.0, margin - consistency_penalty)), 3))
    return facelets, confidence
