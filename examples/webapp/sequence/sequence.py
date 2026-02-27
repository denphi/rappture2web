"""rappture2web port of the 'sequence' zoo example."""
import sys
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
nframes = int(rx['input.integer(nframes).current'].value or 4)

raw = decode(data_b64) if data_b64 else b''

outs = rx['output.sequence(outs)']
outs['about.label'] = 'Animated Sequence'
outs['index.label'] = 'Frame'

for i in range(nframes):
    element = outs['element(%s)' % i]
    element['index'] = i
    element['about.label'] = 'Frame %s' % i

    if _HAS_PIL and raw:
        def fileno():
            raise AttributeError
        image = Image.open(BytesIO(raw))
        rot = image.rotate(i * 360.0 / nframes, expand=True)
        memfile = BytesIO()
        memfile.fileno = fileno
        rot.save(memfile, image.format or 'PNG')
        frame_data = memfile.getvalue()
    else:
        frame_data = raw

    element['image.current'] = encode(frame_data, RPENC_ZB64) if frame_data else ''

rx.close()
