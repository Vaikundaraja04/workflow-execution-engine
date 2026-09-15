from setuptools import setup, find_packages

setup(
    name="workflow-engine",
    version="1.0.0",
    description="Official Python SDK for the Workflow Execution Engine",
    author="Workflow Engine Team",
    packages=find_packages(),
    install_requires=[
        "requests>=2.28.0",
        "pydantic>=2.0.0",
    ],
    python_requires=">=3.8",
)
