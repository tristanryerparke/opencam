import pytest

from opencam.schemas.geometry_2d import ClosedPolyline2D, Point2D


def test_closed_polyline_2d_accepts_closed_vertices():
    polyline = ClosedPolyline2D(
        vertices=[
            Point2D(x=0.0, y=0.0),
            Point2D(x=1.0, y=0.0),
            Point2D(x=0.0, y=0.0),
        ]
    )

    assert polyline.vertices[0] == polyline.vertices[-1]


def test_closed_polyline_2d_rejects_open_vertices():
    with pytest.raises(ValueError, match="first and last vertices are equal"):
        ClosedPolyline2D(
            vertices=[
                Point2D(x=0.0, y=0.0),
                Point2D(x=1.0, y=0.0),
                Point2D(x=1.0, y=1.0),
            ]
        )
