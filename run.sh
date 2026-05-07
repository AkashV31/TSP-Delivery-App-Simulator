#!/bin/bash
echo "=============================================="
echo "  Mumbai TSP Delivery App - Mac Startup Script"
echo "=============================================="
echo

echo "Compiling C engine (TspSolver)..."
gcc -O2 -o engine/TspSolver.exe engine/TspSolver.c
if [ $? -ne 0 ]; then
    echo "[ERROR] C Compilation Failed."
    exit 1
fi
echo "C engine compiled successfully."
echo

echo "Compiling BackendController..."
javac src/BackendController.java
if [ $? -ne 0 ]; then
    echo "[ERROR] Java Compilation Failed."
    exit 1
fi
echo "Java compiled successfully."
echo

echo "Starting Java Server on port 4567..."
echo "Open your browser to http://localhost:4567"
echo
java -cp . src.BackendController
