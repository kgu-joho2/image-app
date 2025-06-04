# Use an official Python runtime as a parent image
FROM python:3.11-slim

# Set the working directory in the container
WORKDIR /app

# Install system dependencies for TTS functionality
RUN apt-get update && apt-get install -y \
    # For PDF processing
    libpoppler-cpp-dev \
    # For image processing and OCR
    libgl1-mesa-glx \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgomp1 \
    # For audio processing
    libsndfile1 \
    # General build tools
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy the backend requirements file and install dependencies
COPY backend/requirements.txt requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy the backend and frontend code into the container
COPY backend/ /app/backend/
COPY frontend/ /app/frontend/

# Make port 5000 available to the world outside this container
EXPOSE 5000

# Define environment variable for the API key (will be passed during runtime)
ENV GOOGLE_API_KEY=""

# Run app.py when the container launches
CMD ["python", "backend/app.py"] 