"""setup.py for compatibility with pip < 21.3 (pre-PEP-517 builds)."""
import os
from setuptools import setup, find_packages

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
        # pydantic v2 requires pydantic-core (Rust, Python>=3.8).
        # Pin to pydantic v1 + the last FastAPI that supports it so the package
        # installs on Python 3.7 and on platforms without a Rust toolchain.
        "pydantic>=1.10.0,<2.0",
        "fastapi>=0.95.2,<0.100.0",
        "uvicorn>=0.20.0",
        "websockets>=10.0",
        "jinja2>=3.1.0",
        "python-multipart>=0.0.6",
        "lxml>=4.9.0",
    ],
    extras_require={
        "dev": ["pytest>=7.0", "httpx>=0.24.0"],
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
