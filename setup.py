"""setup.py for compatibility with pip < 21.3 (pre-PEP-517 builds)."""
import os
from setuptools import setup

version = {}
with open(os.path.join("rappture2web", "_version.py")) as f:
    exec(f.read(), version)

with open("README.md", encoding="utf-8") as f:
    long_description = f.read()

setup(
    name="rappture2web",
    version=version["__version__"],
    description=(
        "Web-based Rappture tool interface - renders XML tool definitions "
        "as interactive web applications"
    ),
    long_description=long_description,
    long_description_content_type="text/markdown",
    license="MIT",
    python_requires=">=3.7",
    # Explicit list instead of find_packages(): package discovery follows
    # symlinks, and sibling-project symlinks in this repo (com_mcp →
    # rappturemcp → rappture2web → …) form a cycle that hangs the build.
    packages=["rappture2web", "rappture2web.puq"],
    package_data={
        "rappture2web": [
            "templates/**/*.html",
            "static/**/*",
            "puq/*.py",
            "contract.xsd",
        ]
    },
    include_package_data=True,
    install_requires=[
        # Pinned to pydantic v1: pydantic v2 requires pydantic-core (a Rust
        # extension) which has no pre-built wheel for Python 3.7 on older platforms.
        # FastAPI 0.103.x is the last series that ships a pydantic v1 shim.
        "pydantic>=1.10.0,<2.0",
        "fastapi>=0.95.2,<=0.103.2",
        # Upper bounds are tight to the last release whose own Requires-Python
        # includes 3.7, verified against PyPI metadata:
        #   uvicorn 0.20.0  — 0.21.0 added python_requires>=3.8
        #   websockets 10.4 — 11.0 added python_requires>=3.8
        #   python-multipart 0.0.6 — 0.0.7 added python_requires>=3.8
        #   lxml 4.9.x      — 5.0 added python_requires>=3.8
        "uvicorn>=0.20.0,<0.21.0",
        "websockets>=10.0,<11.0",
        "jinja2>=3.1.0",
        "python-multipart>=0.0.6,<0.0.7",
        "lxml>=4.9.0,<5.0",
    ],
    extras_require={
        # httpx 0.26.0 added python_requires>=3.8; pytest 8.0 added >=3.8.
        "dev": ["pytest>=7.0,<8.0", "httpx>=0.24.0,<0.26.0"],
    },
    entry_points={
        "console_scripts": ["rappture2web=rappture2web.cli:main"],
    },
    classifiers=[
        "Programming Language :: Python :: 3",
        "License :: OSI Approved :: MIT License",
        "Operating System :: OS Independent",
    ],
)
