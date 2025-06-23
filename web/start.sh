#!/bin/bash

# Spike CPU Monitor Startup Script
echo "🚀 Starting Spike CPU Monitor..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js first."
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install npm first."
    exit 1
fi

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
    if [ $? -ne 0 ]; then
        echo "❌ Failed to install dependencies"
        exit 1
    fi
fi

# Check if spike is built
if [ ! -f "../build/spike" ]; then
    echo "⚠️  Spike executable not found at ../build/spike"
    echo "📝 Please build Spike first:"
    echo "   cd .."
    echo "   ./configure"
    echo "   make"
    echo ""
    echo "🤔 Do you want to continue anyway? (y/n)"
    read -r response
    if [[ ! "$response" =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Start the server
echo "🌐 Starting CPU Monitor server..."
echo "📍 Server will be available at: http://localhost:3000"
echo "🛑 Press Ctrl+C to stop the server"
echo ""

# Start with development mode if available, otherwise use regular start
if npm run dev &> /dev/null; then
    npm run dev
else
    npm start
fi 
