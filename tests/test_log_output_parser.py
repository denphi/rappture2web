from __future__ import annotations

from rappture2web.xml_parser import parse_run_xml


def _make_run_xml(logs: list[str]) -> str:
    # build a run.xml with specified log contents; logs may include id in a tuple
    parts = ['<run>\n  <output>']
    for entry in logs:
        if isinstance(entry, tuple):
            lid, text = entry
            parts.append(f'    <log id="{lid}">')
        else:
            text = entry
            parts.append('    <log>')
        parts.append('      <about><label>Test log</label></about>')
        # indent the payload lines so xml_parser needs to strip correctly
        for line in text.split('\n'):
            parts.append('      ' + line)
        parts.append('    </log>')
    parts.append('  </output>\n</run>')
    return "\n".join(parts)


def test_parse_run_xml_multiple_named_logs(tmp_path):
    """Each <log> with an explicit id should become a separate entry."""
    run_xml = _make_run_xml([
        ('first', 'hello'),
        ('second', 'world'),
    ])
    path = tmp_path / 'run.xml'
    path.write_text(run_xml, encoding='utf-8')

    outputs = parse_run_xml(str(path))
    assert 'first' in outputs
    assert 'second' in outputs
    assert outputs['first']['content'].strip() == 'hello'
    assert outputs['second']['content'].strip() == 'world'


def test_parse_run_xml_duplicate_log_ids(tmp_path):
    """Logs with duplicate ids should be disambiguated rather than overwritten."""
    run_xml = _make_run_xml([
        ('dup', 'one'),
        ('dup', 'two'),
    ])
    path = tmp_path / 'run2.xml'
    path.write_text(run_xml, encoding='utf-8')

    outputs = parse_run_xml(str(path))
    # original id remains, second gets _2 suffix
    assert 'dup' in outputs
    assert 'dup_2' in outputs
    assert outputs['dup']['content'].strip() == 'one'
    assert outputs['dup_2']['content'].strip() == 'two'


def test_parse_run_xml_preserves_whitespace(tmp_path):
    """Leading/trailing spaces/newlines are not stripped completely."""
    # include leading spaces on first line and blank line at end
    text = "  line1\nline2\n"
    run_xml = _make_run_xml([text])
    path = tmp_path / 'run3.xml'
    path.write_text(run_xml, encoding='utf-8')

    outputs = parse_run_xml(str(path))
    assert 'log' in outputs
    content = outputs['log']['content']
    # our helper indents the XML so we expect the parsed log to
    # contain the line with the two leading spaces somewhere; the very first
    # character may be indentation from the surrounding XML.  The important
    # part is that the interior content is preserved and not completely
    # stripped away.
    assert '  line1' in content
    assert content.strip().endswith('line2')
