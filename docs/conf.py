# Configuration file for the Sphinx documentation builder.

project = 'Mosaic Website'
copyright = '2026, Jonathan Harris'
author = 'Jonathan Harris'

# -- General configuration ---------------------------------------------------

extensions = [
    'sphinx_llms_txt',
]

templates_path = ['_templates']
exclude_patterns = ['_build', 'Thumbs.db', '.DS_Store', '.venv']

# -- Options for HTML output -------------------------------------------------

html_theme = 'alabaster'
html_static_path = ['_static']

# -- Options for sphinx-llms-txt ---------------------------------------------
llms_txt_summary = 'A documentation site for the Mosaic Website project, including Firebase functions and frontend assets.'
