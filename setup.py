from __future__ import annotations

import os
from pathlib import Path

from pybind11.setup_helpers import Pybind11Extension, build_ext
from setuptools import setup
import numpy


ROOT = Path(__file__).resolve().parent
OCL_SOURCE_ROOT = Path("third_party") / "opencamlib" / "src"
OCL_ROOT = ROOT / OCL_SOURCE_ROOT
if not OCL_ROOT.exists():
    raise RuntimeError("OpenCAMLib source is missing. Run: git submodule update --init")


def first_existing(*paths: str) -> Path | None:
    for raw_path in paths:
        if not raw_path:
            continue
        path = Path(raw_path)
        if path.exists():
            return path
    return None


def brew_prefix(name: str) -> str:
    return os.popen(f"brew --prefix {name} 2>/dev/null").read().strip()


cgal_prefix = first_existing(
    os.environ.get("CGAL_PREFIX", ""),
    brew_prefix("cgal"),
    "/opt/homebrew/opt/cgal",
    "/usr/local/opt/cgal",
)
if cgal_prefix is None:
    raise RuntimeError("CGAL headers not found. Set CGAL_PREFIX or install brew package 'cgal'.")

include_dirs = [numpy.get_include(), str(cgal_prefix / "include")]
library_dirs: list[str] = []
extra_link_args: list[str] = []


def append_prefix(prefix: Path | None) -> None:
    if prefix is None:
        return
    include_dir = str(prefix / "include")
    lib_dir = str(prefix / "lib")
    if include_dir not in include_dirs:
        include_dirs.append(include_dir)
    if Path(lib_dir).exists() and lib_dir not in library_dirs:
        library_dirs.append(lib_dir)
        extra_link_args.append(f"-Wl,-rpath,{lib_dir}")


append_prefix(first_existing("/opt/homebrew", "/usr/local"))
for dependency in ("boost", "eigen", "gmp", "mpfr"):
    append_prefix(
        first_existing(
            os.environ.get(f"{dependency.upper()}_PREFIX", ""),
            brew_prefix(dependency),
            f"/opt/homebrew/opt/{dependency}",
            f"/usr/local/opt/{dependency}",
        )
    )

ocl_sources = [
    str(OCL_SOURCE_ROOT / "geo" / name)
    for name in (
        "arc.cpp",
        "bbox.cpp",
        "ccpoint.cpp",
        "clpoint.cpp",
        "line.cpp",
        "path.cpp",
        "point.cpp",
        "stlsurf.cpp",
        "triangle.cpp",
    )
] + [
    str(OCL_SOURCE_ROOT / "cutters" / name)
    for name in (
        "ballcutter.cpp",
        "bullcutter.cpp",
        "cylcutter.cpp",
        "ellipse.cpp",
        "ellipseposition.cpp",
        "millingcutter.cpp",
    )
] + [
    str(OCL_SOURCE_ROOT / "dropcutter" / name)
    for name in (
        "adaptivepathdropcutter.cpp",
        "batchdropcutter.cpp",
        "pathdropcutter.cpp",
        "pointdropcutter.cpp",
    )
] + [
    str(OCL_SOURCE_ROOT / "algo" / name)
    for name in ("fiber.cpp", "interval.cpp")
] + [str(OCL_SOURCE_ROOT / "common" / "numeric.cpp")]

ocl_include_dirs = include_dirs + [
    str(OCL_ROOT / name) for name in ("algo", "common", "cutters", "dropcutter", "geo")
]

ext_modules = [
    Pybind11Extension(
        "opencam._cgal_planar",
        ["src/opencam/_cgal_planar.cpp"],
        include_dirs=include_dirs,
        library_dirs=library_dirs,
        libraries=["gmp", "mpfr"],
        define_macros=[("CGAL_HEADER_ONLY", "1")],
        cxx_std=17,
        extra_link_args=extra_link_args,
    ),
    Pybind11Extension(
        "opencam._opencamlib",
        ["src/opencam/_opencamlib.cpp", *ocl_sources],
        include_dirs=ocl_include_dirs,
        library_dirs=library_dirs,
        cxx_std=17,
        extra_link_args=extra_link_args,
    ),
]

setup(ext_modules=ext_modules, cmdclass={"build_ext": build_ext})
