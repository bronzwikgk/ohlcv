import nbformat as nbf

with open('E:\\github\\ohlcv\\notebook\\behavioral_signature_2.ipynb', 'r') as f:
    nb = nbf.read(f, as_version=4)

# Replace the seed in cell 1
old_source = nb.cells[1].source
new_source = old_source.replace("SEED = 42 # Change this to test different batches", "SEED = 99 # Changed to test a different batch of stocks")
nb.cells[1].source = new_source

with open('E:\\github\\ohlcv\\notebook\\behavioral_signature_2.ipynb', 'w') as f:
    nbf.write(nb, f)
