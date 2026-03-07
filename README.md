# rappture2web

**rappture2web** turns [Rappture](https://nanohub.org/infrastructure/rappture/) tool XML definitions into interactive web applications — no desktop GUI required.

It reads a `tool.xml` file, renders the input form in a browser, runs the simulation backend, and displays the output visualizations (curves, fields, tables, maps, and more) in real time over WebSocket.

## Features

- Drop-in replacement for the classic Rappture Python library (`rp_library`)
- Supports all common Rappture output types: `curve`, `histogram`, `field` (2D/3D/VTK/vector), `table`, `sequence`, `image`, `string`, `number`, `log`, `mapviewer`
- Interactive control panels: theme toggle, download (SVG/PNG/JSON), zoom, colorscale, legend position
- Compare mode: overlay multiple simulation runs on the same plot
- All JavaScript dependencies are bundled (Plotly 3.4, Three.js 0.128) — no CDN required

## Installation

```bash
pip install rappture2web
```

## Quick start

```bash
# Run an existing Rappture tool
rappture2web /path/to/tool/

# Or specify the tool.xml directly
rappture2web /path/to/tool/tool.xml
```

Then open `http://localhost:8000` in your browser.

## Tool script compatibility

Tool scripts require only a one-line change — replace the Rappture import:

```python
# Before
import Rappture
rx = Rappture.PyXml(sys.argv[1])

# After
import rappture2web.rp_library as Rappture
rx = Rappture.PyXml(sys.argv[1])
```

All `rx['input.(id).current'].value` reads and `rx['output.curve(f).component.xy'] = data` writes work unchanged.

## Supported output types

| Type | Description |
|------|-------------|
| `curve` | XY line plots with legend, zoom, download |
| `histogram` | Bar histogram |
| `field` | 2D heatmap, 3D scalar volume, VTK structured points, unstructured mesh, vector/flow |
| `table` | Data tables |
| `sequence` | Animated frame sequences |
| `image` | PNG/JPEG images |
| `mapviewer` | Geographic maps (scatter, choropleth, heatmap layers) |
| `string`, `number`, `integer`, `boolean` | Scalar outputs |
| `log` | Simulation log output |

## Documentation

Full documentation is available at [https://rappture2web.readthedocs.io](https://rappture2web.readthedocs.io).

## License

MIT
