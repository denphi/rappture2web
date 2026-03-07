Changelog
=========

0.1.8 (unreleased)
-------------------

- **UQ support**: Uncertainty Quantification for numeric inputs using PUQ
  Smolyak sparse grids.  Supports uniform and gaussian distributions.
  Per-input opt-out with ``<uq>false</uq>``.
- Added ``uq_enabled`` field to ``ToolInfo`` and per-input ``uq_enabled`` attrs
- Added ``run_uq_simulation()`` to simulator
- Added UQ distribution controls to number/integer widget templates
- Added UQ webapp examples (``uq_simple``, ``uq_projectile``)
- Shipped PUQ helper scripts (``get_params.py``, ``inject_results.py``,
  ``analyze.py``, ``get_response.py``) as package data

0.1.7
-----

- Fixed VTK ``SetInput`` AttributeError on NanoHUB by stripping anaconda paths
  from PATH in wrapper script
- Removed ``submit --local`` wrapper (no longer needed)
- Tagged and published to PyPI

0.1.6
-----

- Wrapper script improvements for NanoHUB compatibility
- Added debug output to wrapper scripts

0.1.5
-----

- Initial public release
- Classic mode and library mode support
- All Rappture output types: curve, histogram, field (2D/3D/VTK/vector),
  table, sequence, image, string, number, log, mapviewer
- Run history with compare mode
- Bundled Plotly 3.4 and Three.js 0.128
