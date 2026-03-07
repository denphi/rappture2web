"""Sphinx configuration for rappture2web documentation."""

import os
import sys

sys.path.insert(0, os.path.abspath("../.."))

project = "rappture2web"
copyright = "2024, rappture2web contributors"
author = "rappture2web contributors"

# Read version from package
try:
    from rappture2web._version import __version__
    release = __version__
except ImportError:
    release = "0.1.7"

version = ".".join(release.split(".")[:2])

extensions = [
    "sphinx.ext.autodoc",
    "sphinx.ext.napoleon",
    "sphinx.ext.viewcode",
    "sphinx.ext.intersphinx",
    "sphinx_copybutton",
]

templates_path = ["_templates"]
exclude_patterns = []

html_theme = "sphinx_rtd_theme"
html_static_path = ["_static"]

intersphinx_mapping = {
    "python": ("https://docs.python.org/3", None),
}

autodoc_member_order = "bysource"
napoleon_google_docstring = True
