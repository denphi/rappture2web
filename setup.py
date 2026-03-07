"""setup.py for compatibility with pip < 21.3 (pre-PEP-517 builds).

Modern pip reads everything from pyproject.toml. This file duplicates
the essential metadata so that older pip can still install the package.
"""
import os
from setuptools import setup, find_packages

# Read version without importing the package
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
    packages=find_packages(include=["rappture2web", "rappture2web.*"]),
    package_data={
        "rappture2web": [
            "templates/**/*.html",
            "static/**/*",
            "puq/*.py",
        ]
    },
    include_package_data=True,
    install_requires=[
        "fastapi>=0.95.2,<=0.103.2",
        "uvicorn>=0.20.0",
        "websockets>=10.0",
        "jinja2>=3.1.0",
        "python-multipart>=0.0.6",
        "lxml>=4.9.0",
    ],
    extras_require={
        "dev": [
            "pytest>=7.0",
            "httpx>=0.24.0",
        ]
    },
    entry_points={
        "console_scripts": [
            "rappture2web=rappture2web.cli:main",
        ]
    },
    classifiers=[
        "Development Status :: 3 - Alpha",
        "Intended Audience :: Science/Research",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.7",
        "Programming Language :: Python :: 3.8",
        "Programming Language :: Python :: 3.9",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
        "Programming Language :: Python :: 3.12",
        "Topic :: Scientific/Engineering :: Visualization",
        "Topic :: Internet :: WWW/HTTP :: WSGI :: Application",
    ],
)
