import './style.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { isMac } from './lib/platform';

document.documentElement.dataset.platform = isMac ? 'mac' : 'win';

mount(App, { target: document.getElementById('app')! });
