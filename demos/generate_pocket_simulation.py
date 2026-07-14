#!/usr/bin/env python3
from pathlib import Path
from time import perf_counter


if __name__ == "__main__":
    import generate_pocket_cl

    total_started_at = perf_counter()

    started_at = perf_counter()
    from opencam.simulation.swept_volume import simulate_swept_milling_stl

    simulation_import_seconds = perf_counter() - started_at

    stock_path = generate_pocket_cl.asset_dir / "pocketing_A_stock.stl"
    output_path = Path("pocket-simulation-result.stl")

    started_at = perf_counter()
    stock_bytes = stock_path.read_bytes()
    stock_read_seconds = perf_counter() - started_at

    started_at = perf_counter()
    result_stl = simulate_swept_milling_stl(stock_bytes, generate_pocket_cl.cl_data)
    simulation_seconds = perf_counter() - started_at

    started_at = perf_counter()
    output_path.write_bytes(result_stl)
    write_seconds = perf_counter() - started_at

    total_seconds = perf_counter() - total_started_at

    print(f"Saved {output_path}")
    print(f"Simulation import: {simulation_import_seconds:.3f}s")
    print(f"Stock STL read: {stock_read_seconds:.3f}s")
    print(f"Simulation: {simulation_seconds:.3f}s")
    print(f"Output STL write: {write_seconds:.3f}s")
    print(f"Total: {total_seconds:.3f}s")
