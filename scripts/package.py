"""Build atlas-studio-site.zip containing only the files needed on a static host."""
import os, zipfile

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
files = ['index.html', 'styles.css', 'README.md', 'version.json']
files += [os.path.join('src', f) for f in sorted(os.listdir(os.path.join(root, 'src'))) if f.endswith('.js')]
files += [os.path.join('assets', f) for f in sorted(os.listdir(os.path.join(root, 'assets')))]
out = os.path.join(root, 'atlas-studio-site.zip')
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for f in files:
        z.write(os.path.join(root, f), f.replace(os.sep, '/'))
print('wrote', out, 'with', len(files), 'files')
