# Use an official Python runtime as a parent image
FROM python:3.11-slim

# Set the working directory in the container
WORKDIR /app

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