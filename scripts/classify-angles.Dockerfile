# Dev-only image for scripts/classify-angles.py. Pinned to a mediapipe release that still ships
# the bundled FaceMesh model (`mp.solutions`), so no model download is needed at run time.
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir mediapipe==0.10.14 opencv-python-headless numpy
WORKDIR /work
COPY classify-angles.py /work/classify-angles.py
ENTRYPOINT ["python", "/work/classify-angles.py"]
