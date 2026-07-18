from __future__ import annotations

import random

from app.cube.model import SOLVED_STATE
from app.cube.moves import MOVES, apply_sequence
from app.cube.solver import OptimalSolver


def test_solver_is_exact_for_random_scrambles(tmp_path):
    solver = OptimalSolver(tmp_path / "distance.bin")
    solver.generate()
    assert solver.solve(SOLVED_STATE) == []
    assert solver.maximum_distance == 11

    randomizer = random.Random(42)
    for _ in range(80):
        state = apply_sequence(SOLVED_STATE, [randomizer.choice(MOVES) for _ in range(30)])
        solution = solver.solve(state)
        assert len(solution) == solver.distance(state)
        assert apply_sequence(state, solution).is_solved
