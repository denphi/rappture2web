"""rappture2web port of the 'image' zoo example."""
import sys
import re
from io import BytesIO
import rappture2web.rp_library as Rappture
from rappture2web.encoding import decode, encode

try:
    from PIL import Image
    _HAS_PIL = True
except ImportError:
    _HAS_PIL = False

RPENC_ZB64 = 3

rx = Rappture.PyXml(sys.argv[1])

data_b64 = rx['input.image.current'].value
angle_str = rx['input.(angle).current'].value

m = re.match(r'^([+-]?\d*\.?\d+)', str(angle_str).strip())
angle_f = float(m.group(1)) if m else 0.0

raw = decode(data_b64) if data_b64 else b''

if _HAS_PIL and raw:
    def fileno():
        raise AttributeError
    image = Image.open(BytesIO(raw))
    rot = image.rotate(angle_f, expand=True)
    memfile = BytesIO()
    memfile.fileno = fileno
    rot.save(memfile, image.format or 'PNG')
    rotated = memfile.getvalue()
else:
    rotated = raw

out_data = encode(rotated, RPENC_ZB64) if rotated else ''

rx['output.image(outi).about.label'] = 'Rotated Image'
rx['output.image(outi).current'] = out_data

rx.close()
