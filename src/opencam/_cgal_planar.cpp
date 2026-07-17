#include <cstdint>
#include <stdexcept>
#include <string>
#include <vector>

#include <CGAL/Exact_predicates_inexact_constructions_kernel.h>
#include <CGAL/Polygon_mesh_processing/polygon_soup_to_polygon_mesh.h>
#include <CGAL/Polygon_mesh_processing/remesh_planar_patches.h>
#include <CGAL/Surface_mesh.h>
#include <CGAL/boost/graph/helpers.h>
#include <CGAL/boost/graph/iterator.h>
#include <pybind11/numpy.h>
#include <pybind11/pybind11.h>

namespace py = pybind11;
namespace PMP = CGAL::Polygon_mesh_processing;

using Kernel = CGAL::Exact_predicates_inexact_constructions_kernel;
using Point = Kernel::Point_3;
using Mesh = CGAL::Surface_mesh<Point>;
using VertexIndex = Mesh::Vertex_index;
using FaceIndex = Mesh::Face_index;

std::tuple<py::array_t<double>, py::array_t<std::int64_t>> remesh_planar_patches(
    py::array_t<double, py::array::c_style | py::array::forcecast> vertices,
    py::array_t<std::int64_t, py::array::c_style | py::array::forcecast> faces
) {
    auto vertices_info = vertices.request();
    auto faces_info = faces.request();

    if (vertices_info.ndim != 2 || vertices_info.shape[1] < 3) {
        throw std::runtime_error("Expected vertices with shape (n, >=3).");
    }
    if (faces_info.ndim != 2 || faces_info.shape[1] != 3) {
        throw std::runtime_error("Expected triangular faces with shape (m, 3).");
    }

    auto* vertices_ptr = static_cast<const double*>(vertices_info.ptr);
    auto* faces_ptr = static_cast<const std::int64_t*>(faces_info.ptr);
    const auto vertex_count = static_cast<std::size_t>(vertices_info.shape[0]);
    const auto face_count = static_cast<std::size_t>(faces_info.shape[0]);
    const auto vertex_stride = static_cast<std::size_t>(vertices_info.shape[1]);

    std::vector<Point> points;
    points.reserve(vertex_count);
    for (std::size_t index = 0; index < vertex_count; ++index) {
        const auto* row = vertices_ptr + index * vertex_stride;
        points.emplace_back(row[0], row[1], row[2]);
    }

    std::vector<std::vector<std::size_t>> polygons;
    polygons.reserve(face_count);
    for (std::size_t index = 0; index < face_count; ++index) {
        const auto* row = faces_ptr + index * 3;
        const auto a = static_cast<std::size_t>(row[0]);
        const auto b = static_cast<std::size_t>(row[1]);
        const auto c = static_cast<std::size_t>(row[2]);
        if (a >= vertex_count || b >= vertex_count || c >= vertex_count) {
            throw std::runtime_error("Face index out of bounds.");
        }
        polygons.push_back({a, b, c});
    }

    PMP::orient_polygon_soup(points, polygons);

    Mesh input_mesh;
    PMP::polygon_soup_to_polygon_mesh(points, polygons, input_mesh);

    if (!CGAL::is_triangle_mesh(input_mesh)) {
        throw std::runtime_error("CGAL input mesh must be triangular.");
    }

    Mesh output_mesh;
    PMP::remesh_planar_patches(input_mesh, output_mesh);

    std::vector<std::int64_t> output_vertex_ids(output_mesh.number_of_vertices(), -1);

    py::array_t<double> output_vertices(std::vector<py::ssize_t>{
        static_cast<py::ssize_t>(output_mesh.number_of_vertices()),
        3,
    });
    auto output_vertices_view = output_vertices.mutable_unchecked<2>();

    std::int64_t output_vertex_index = 0;
    for (const VertexIndex vertex : output_mesh.vertices()) {
        const Point& point = output_mesh.point(vertex);
        output_vertices_view(output_vertex_index, 0) = point.x();
        output_vertices_view(output_vertex_index, 1) = point.y();
        output_vertices_view(output_vertex_index, 2) = point.z();
        output_vertex_ids[static_cast<std::size_t>(vertex.idx())] = output_vertex_index;
        ++output_vertex_index;
    }

    py::array_t<std::int64_t> output_faces(std::vector<py::ssize_t>{
        static_cast<py::ssize_t>(output_mesh.number_of_faces()),
        3,
    });
    auto output_faces_view = output_faces.mutable_unchecked<2>();

    std::int64_t output_face_index = 0;
    for (const FaceIndex face : output_mesh.faces()) {
        std::int64_t corners[3];
        int corner_count = 0;
        for (const VertexIndex vertex : CGAL::vertices_around_face(output_mesh.halfedge(face), output_mesh)) {
            if (corner_count >= 3) {
                throw std::runtime_error("CGAL returned a non-triangular face.");
            }
            const auto vertex_id = output_vertex_ids[static_cast<std::size_t>(vertex.idx())];
            if (vertex_id < 0) {
                throw std::runtime_error("CGAL returned a face with an unknown vertex.");
            }
            corners[corner_count++] = vertex_id;
        }
        if (corner_count != 3) {
            throw std::runtime_error("CGAL returned a degenerate face.");
        }
        output_faces_view(output_face_index, 0) = corners[0];
        output_faces_view(output_face_index, 1) = corners[1];
        output_faces_view(output_face_index, 2) = corners[2];
        ++output_face_index;
    }

    return {output_vertices, output_faces};
}

PYBIND11_MODULE(_cgal_planar, module) {
    module.doc() = "Minimal CGAL planar patch remeshing bindings for OpenCAM.";
    module.def("remesh_planar_patches", &remesh_planar_patches, py::arg("vertices"), py::arg("faces"));
}
