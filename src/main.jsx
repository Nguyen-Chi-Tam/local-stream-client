import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import '../styles.css';
import '../responsive.css';
import { createDesktopBridge } from './functions/desktopBridge.js';

createDesktopBridge();
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
