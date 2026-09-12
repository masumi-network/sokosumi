"""Extract the Apple client's existing operations plus requested paths (optionally path#method) from Core OpenAPI."""
import json
import sys
from pathlib import Path

source = json.loads(Path(sys.argv[1]).read_text())
target = Path(__file__).resolve().parents[1] / 'Packages/CoreAPI/Sources/CoreAPI/openapi.json'
previous = json.loads(target.read_text())
paths = dict(previous['paths'])
for selection in sys.argv[2:]:
    path, _, method = selection.partition('#')
    paths[path] = {method: source['paths'][path][method]} if method else source['paths'][path]
for path, operations in paths.items():
    paths[path] = {method: source['paths'][path][method] for method in operations}
components = {}
def collect(value):
    if isinstance(value, dict):
        ref = value.get('$ref', '')
        if ref.startswith('#/components/'):
            _, _, category, name = ref.split('/')
            group = components.setdefault(category, {})
            if name not in group:
                group[name] = source['components'][category][name]
                collect(group[name])
        for child in value.values():
            collect(child)
    elif isinstance(value, list):
        for child in value:
            collect(child)
collect(paths)
for category, group in components.items():
    order = list(previous['components'].get(category, {}))
    order += [name for name in group if name not in order]
    components[category] = {name: group[name] for name in order if name in group}
previous['paths'] = paths
previous['components'] = components
target.write_text(json.dumps(previous, indent=2, ensure_ascii=False) + '\n')
