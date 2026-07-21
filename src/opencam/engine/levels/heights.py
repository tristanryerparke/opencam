def compute_layer_heights(
    z_bounds: tuple[float, float],
    z_step_height: float,
) -> list[float]:
    if z_step_height <= 0:
        raise ValueError("Z step height must be greater than 0.")

    top_z = max(z_bounds)
    bottom_z = min(z_bounds)
    depth_of_cut = top_z - bottom_z

    if depth_of_cut <= 0 or depth_of_cut <= z_step_height:
        return [bottom_z]

    layer_heights: list[float] = []
    current_z = top_z

    while True:
        next_z = max(current_z - z_step_height, bottom_z)
        layer_heights.append(next_z)
        if next_z <= bottom_z:
            break
        current_z = next_z

    return layer_heights
