#include <cmath>
#include <cstdint>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

#include <pybind11/numpy.h>
#include <pybind11/pybind11.h>

#include "adaptivepathdropcutter.hpp"
#include "ballcutter.hpp"
#include "cylcutter.hpp"
#include "path.hpp"
#include "point.hpp"
#include "stlsurf.hpp"
#include "triangle.hpp"

namespace py = pybind11;

namespace {

class DropCutterBackend {
public:
    DropCutterBackend(
        py::array_t<double, py::array::c_style | py::array::forcecast> vertices,
        py::array_t<std::int64_t, py::array::c_style | py::array::forcecast> faces,
        const std::string& tool_type,
        double diameter,
        double length
    ) {
        if (!(diameter > 0.0) || !(length > 0.0)) {
            throw std::invalid_argument("OpenCAMLib cutter diameter and length must be greater than zero.");
        }

        const auto vertices_info = vertices.request();
        const auto faces_info = faces.request();
        if (vertices_info.ndim != 2 || vertices_info.shape[1] != 3) {
            throw std::invalid_argument("OpenCAMLib vertices must have shape (n, 3).");
        }
        if (faces_info.ndim != 2 || faces_info.shape[1] != 3) {
            throw std::invalid_argument("OpenCAMLib faces must have shape (m, 3).");
        }

        const auto* vertex_data = static_cast<const double*>(vertices_info.ptr);
        const auto* face_data = static_cast<const std::int64_t*>(faces_info.ptr);
        const auto vertex_count = static_cast<std::size_t>(vertices_info.shape[0]);
        const auto face_count = static_cast<std::size_t>(faces_info.shape[0]);
        const auto vertex_stride = static_cast<std::size_t>(vertices_info.shape[1]);
        if (vertex_count < 3 || face_count == 0) {
            throw std::invalid_argument("OpenCAMLib surface requires vertices and faces.");
        }
        for (std::size_t vertex_index = 0; vertex_index < vertex_count; ++vertex_index) {
            const auto* vertex = vertex_data + vertex_index * vertex_stride;
            if (!std::isfinite(vertex[0]) || !std::isfinite(vertex[1]) || !std::isfinite(vertex[2])) {
                throw std::invalid_argument("OpenCAMLib vertices must be finite.");
            }
        }

        for (std::size_t face_index = 0; face_index < face_count; ++face_index) {
            const auto* face = face_data + face_index * 3;
            const auto a = checked_vertex_index(face[0], vertex_count);
            const auto b = checked_vertex_index(face[1], vertex_count);
            const auto c = checked_vertex_index(face[2], vertex_count);
            if (a == b || b == c || a == c) {
                throw std::invalid_argument("OpenCAMLib faces must not repeat vertices.");
            }
            const auto* va = vertex_data + a * vertex_stride;
            const auto* vb = vertex_data + b * vertex_stride;
            const auto* vc = vertex_data + c * vertex_stride;
            const auto ab = ocl::Point(vb[0] - va[0], vb[1] - va[1], vb[2] - va[2]);
            const auto ac = ocl::Point(vc[0] - va[0], vc[1] - va[1], vc[2] - va[2]);
            const auto normal = ab.cross(ac);
            if (normal.dot(normal) <= 1e-24) {
                throw std::invalid_argument("OpenCAMLib faces must not be degenerate.");
            }
            surface_.addTriangle(ocl::Triangle(
                ocl::Point(va[0], va[1], va[2]),
                ocl::Point(vb[0], vb[1], vb[2]),
                ocl::Point(vc[0], vc[1], vc[2])
            ));
        }
        if (surface_.size() == 0) {
            throw std::invalid_argument("OpenCAMLib surface requires at least one face.");
        }

        if (tool_type == "ball") {
            cutter_ = std::make_unique<ocl::BallCutter>(diameter, length);
        } else if (tool_type == "cylinder") {
            cutter_ = std::make_unique<ocl::CylCutter>(diameter, length);
        } else {
            throw std::invalid_argument("OpenCAMLib supports only ball and cylinder cutters.");
        }

        operation_.setSTL(surface_);
        operation_.setCutter(cutter_.get());
    }

    py::array_t<double> project(
        py::array_t<double, py::array::c_style | py::array::forcecast> path_xy,
        double baseline_z,
        double sampling,
        double min_sampling
    ) {
        const auto path_info = path_xy.request();
        if (path_info.ndim != 2 || path_info.shape[1] != 2 || path_info.shape[0] < 2) {
            throw std::invalid_argument("OpenCAMLib path must have shape (n, 2), with n >= 2.");
        }
        if (!(sampling > 0.0) || !(min_sampling > 0.0) || !std::isfinite(baseline_z)) {
            throw std::invalid_argument("OpenCAMLib path and sampling values must be finite and positive.");
        }

        const auto* path_data = static_cast<const double*>(path_info.ptr);
        for (std::size_t index = 0; index < static_cast<std::size_t>(path_info.shape[0]); ++index) {
            if (!std::isfinite(path_data[index * 2]) || !std::isfinite(path_data[index * 2 + 1])) {
                throw std::invalid_argument("OpenCAMLib path coordinates must be finite.");
            }
        }
        const auto path_count = static_cast<std::size_t>(path_info.shape[0]);
        ocl::Path path;
        for (std::size_t index = 1; index < path_count; ++index) {
            const auto* start = path_data + (index - 1) * 2;
            const auto* end = path_data + index * 2;
            path.append(ocl::Line(
                ocl::Point(start[0], start[1], baseline_z),
                ocl::Point(end[0], end[1], baseline_z)
            ));
        }

        operation_.setSampling(sampling);
        operation_.setMinSampling(min_sampling);
        // APDC uses a tangent-angle flatness test. For a midpoint bulge e on
        // a span of length L, the angle is approximately 4e/L.
        const auto half_pi = std::acos(-1.0) / 2.0;
        operation_.setCosLimit(std::cos(std::min(half_pi, 4.0 * min_sampling / sampling)));
        operation_.setPath(&path);
        {
            py::gil_scoped_release release;
            operation_.run();
        }

        const auto points = operation_.getPoints();
        py::array_t<double> result({
            static_cast<py::ssize_t>(points.size()),
            static_cast<py::ssize_t>(3),
        });
        auto result_view = result.mutable_unchecked<2>();
        for (py::ssize_t index = 0; index < static_cast<py::ssize_t>(points.size()); ++index) {
            result_view(index, 0) = points[static_cast<std::size_t>(index)].x;
            result_view(index, 1) = points[static_cast<std::size_t>(index)].y;
            result_view(index, 2) = points[static_cast<std::size_t>(index)].z;
        }
        return result;
    }

private:
    static std::size_t checked_vertex_index(std::int64_t index, std::size_t vertex_count) {
        if (index < 0 || static_cast<std::uint64_t>(index) >= vertex_count) {
            throw std::invalid_argument("OpenCAMLib face index is out of bounds.");
        }
        return static_cast<std::size_t>(index);
    }

    ocl::STLSurf surface_;
    std::unique_ptr<ocl::MillingCutter> cutter_;
    ocl::AdaptivePathDropCutter operation_;
};

} // namespace

PYBIND11_MODULE(_opencamlib, module) {
    module.doc() = "Small pybind11 adapter around OpenCAMLib drop-cutter.";
    py::class_<DropCutterBackend>(module, "DropCutterBackend")
        .def(
            py::init<
                py::array_t<double, py::array::c_style | py::array::forcecast>,
                py::array_t<std::int64_t, py::array::c_style | py::array::forcecast>,
                const std::string&,
                double,
                double
            >(),
            py::arg("vertices"),
            py::arg("faces"),
            py::arg("tool_type"),
            py::arg("diameter"),
            py::arg("length")
        )
        .def(
            "project",
            &DropCutterBackend::project,
            py::arg("path_xy"),
            py::arg("baseline_z"),
            py::arg("sampling"),
            py::arg("min_sampling")
        );
}
