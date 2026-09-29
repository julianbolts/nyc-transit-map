import {cp,mkdir} from 'node:fs/promises';
await mkdir('dist/assets',{recursive:true});
await cp('public/data','dist/assets/data',{recursive:true});
await cp('public/map','dist/assets/map',{recursive:true});
await cp('src/styles.css','dist/styles.css');
