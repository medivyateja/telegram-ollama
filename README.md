# Express EJS Tailwind Project

A web application built with Express.js, EJS templating engine, and Tailwind CSS.

## Features

- Express.js web server
- EJS templating
- Tailwind CSS for styling
- Static file serving
- Environment variable support

## Prerequisites

- Node.js (v14 or higher)
- npm

## Installation

1. Clone the repository:
```bash
git clone <your-repository-url>
cd express-ejs-tailwind-project
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the root directory and add your environment variables:
```bash
cp .env.example .env
```

## Development

1. Start the Tailwind CSS build process:
```bash
npm run build:css
```

2. Run the development server:
```bash
npm run dev
```

The application will be available at `http://localhost:3000`.

## Project Structure

```
├── public/
│   └── css/
│       └── styles.css
├── src/
│   └── css/
│       └── styles.css
├── views/
│   └── index.ejs
├── .env
├── .gitignore
├── index.js
├── package.json
└── README.md
```