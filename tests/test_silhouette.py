from shapely.geometry import Polygon

from opencam.schemas.mesh import Mesh
from opencam.utilities.silhouette import silhouette


def test_silhouette_unions_projected_faces():
    mesh = Mesh(
        vertices=[
            (0.0, 0.0, 0.0),
            (4.0, 0.0, 1.0),
            (4.0, 4.0, 2.0),
            (2.0, 4.0, 3.0),
            (2.0, 2.0, 4.0),
            (0.0, 2.0, 5.0),
        ],
        faces=[(0, 1, 5), (1, 4, 5), (1, 2, 4), (2, 3, 4)],
    )

    outline = silhouette(mesh)

    assert Polygon([(point.x, point.y) for point in outline.vertices]).equals(
        Polygon([(0.0, 0.0), (4.0, 0.0), (4.0, 4.0), (2.0, 4.0), (2.0, 2.0), (0.0, 2.0)])
    )
