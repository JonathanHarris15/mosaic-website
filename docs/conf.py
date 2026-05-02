# Configuration file for the Sphinx documentation builder.

project = 'Mosaic Website'
copyright = '2026, Jonathan Harris'
author = 'Jonathan Harris'

# -- General configuration ---------------------------------------------------

extensions = [
    'sphinx_llms_txt',
    'sphinx_js',
    'sphinx_markdown_builder',
]

# Path to the JavaScript source files
js_source_path = ['../functions', '../public', '../scripts']
root_for_relative_js_paths = '..'
primary_domain = 'js'

templates_path = ['_templates']
exclude_patterns = ['_build', 'Thumbs.db', '.DS_Store', '.venv', 'node_modules']

# -- Options for HTML output -------------------------------------------------

html_theme = 'alabaster'
html_static_path = ['_static']

# -- Options for sphinx-llms-txt ---------------------------------------------
llms_txt_summary = 'A documentation site for the Mosaic Website project, including Firebase functions and frontend assets.'

# Include source code in llms-full.txt for better LLM context
llms_txt_include_code = [
    "+:functions/**/*.js",
    "+:public/**/*.js",
    "+:scripts/**/*.js",
    "-:node_modules/**",
    "-:docs/_build/**"
]
