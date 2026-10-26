import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import { IN_CLAUDE } from './platform';
import App from './App';
import './index.css';
import { applyBrand, cachedBrand } from './lib/palettes';

// Paint with the hotel's last-used brand colours straight away.
applyBrand(cachedBrand(), { remember: false });

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {IN_CLAUDE ? <HashRouter><App /></HashRouter> : <BrowserRouter><App /></BrowserRouter>}
  </React.StrictMode>,
);
