from __future__ import annotations

import os
import struct
from array import array
from collections import deque
from pathlib import Path

from .coordinates import (
    ORIENTATION_COUNT,
    PERMUTATION_COUNT,
    STATE_COUNT,
    decode_orientation,
    decode_permutation,
    encode_orientation,
    encode_permutation,
    encode_state,
)
from .model import SOLVED_STATE, CubeState
from .moves import MOVES, Move, apply_move, apply_sequence

_MAGIC = b"R2HTM01\0"
_HEADER = struct.Struct("<8sI")


def default_table_path() -> Path:
    configured = os.environ.get("RUBICKS_SOLVER_CACHE_DIR")
    root = Path(configured) if configured else Path(__file__).parents[3] / ".cache"
    return root / "solver" / "htm-distance-v1.bin"


class OptimalSolver:
    def __init__(self, table_path: Path | None = None) -> None:
        self.table_path = table_path or default_table_path()
        self._permutation_moves: array[int] | None = None
        self._orientation_moves: array[int] | None = None
        self._distances: bytes | bytearray | None = None

    def _build_move_tables(self) -> tuple[array[int], array[int]]:
        permutation_moves = array("H")
        for coordinate in range(PERMUTATION_COUNT):
            state = decode_permutation(coordinate)
            permutation_moves.extend(encode_permutation(apply_move(state, move)) for move in MOVES)

        orientation_moves = array("H")
        for coordinate in range(ORIENTATION_COUNT):
            state = decode_orientation(coordinate)
            orientation_moves.extend(encode_orientation(apply_move(state, move)) for move in MOVES)
        return permutation_moves, orientation_moves

    def generate(self, *, force: bool = False) -> Path:
        if self.table_path.exists() and not force:
            self.load()
            return self.table_path

        permutation_moves, orientation_moves = self._build_move_tables()
        distances = bytearray([255]) * STATE_COUNT
        distances[0] = 0
        queue: deque[int] = deque([0])
        while queue:
            current = queue.popleft()
            permutation, orientation = divmod(current, ORIENTATION_COUNT)
            next_distance = distances[current] + 1
            permutation_offset = permutation * len(MOVES)
            orientation_offset = orientation * len(MOVES)
            for move_index in range(len(MOVES)):
                neighbor = (
                    permutation_moves[permutation_offset + move_index] * ORIENTATION_COUNT
                    + orientation_moves[orientation_offset + move_index]
                )
                if distances[neighbor] == 255:
                    distances[neighbor] = next_distance
                    queue.append(neighbor)

        if 255 in distances:
            raise RuntimeError("Solver table generation did not reach every reduced state")
        self.table_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.table_path.with_suffix(".tmp")
        temporary.write_bytes(_HEADER.pack(_MAGIC, STATE_COUNT) + distances)
        temporary.replace(self.table_path)
        self._permutation_moves = permutation_moves
        self._orientation_moves = orientation_moves
        self._distances = distances
        return self.table_path

    def load(self) -> None:
        if self._distances is not None:
            return
        if not self.table_path.exists():
            self.generate()
            return
        data = self.table_path.read_bytes()
        expected_size = _HEADER.size + STATE_COUNT
        if len(data) != expected_size:
            self.generate(force=True)
            return
        magic, state_count = _HEADER.unpack_from(data)
        if magic != _MAGIC or state_count != STATE_COUNT:
            self.generate(force=True)
            return
        self._distances = data[_HEADER.size :]
        self._permutation_moves, self._orientation_moves = self._build_move_tables()

    @property
    def maximum_distance(self) -> int:
        self.load()
        assert self._distances is not None
        return max(self._distances)

    def distance(self, state: CubeState) -> int:
        self.load()
        assert self._distances is not None
        return self._distances[encode_state(state)]

    def solve(self, state: CubeState) -> list[Move]:
        self.load()
        assert self._distances is not None
        current = state
        result: list[Move] = []
        while current != SOLVED_STATE:
            distance = self._distances[encode_state(current)]
            for move in MOVES:
                candidate = apply_move(current, move)
                if self._distances[encode_state(candidate)] == distance - 1:
                    result.append(move)
                    current = candidate
                    break
            else:
                raise RuntimeError("Distance table contains no descending solution move")
        if apply_sequence(state, result) != SOLVED_STATE:
            raise RuntimeError("Internal solver verification failed")
        return result


_solver: OptimalSolver | None = None


def get_solver() -> OptimalSolver:
    global _solver
    if _solver is None:
        _solver = OptimalSolver()
    return _solver


def main() -> None:
    solver = OptimalSolver()
    path = solver.generate()
    print(f"Generated {STATE_COUNT:,}-state HTM table at {path}")
    print(f"Maximum distance: {solver.maximum_distance}")


if __name__ == "__main__":
    main()
