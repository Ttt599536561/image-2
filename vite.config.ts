import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { handleImageProxyRequest } from './src/server/imageProxy';

function imageProxyPlugin(): Plugin {
  return {
    name: 'local-image-proxy',
    configureServer(server) {
      server.middlewares.use('/api/generate', (request, response) => {
        let body = '';

        request.on('data', (chunk: Buffer) => {
          body += chunk.toString('utf8');
        });

        request.on('end', () => {
          void handleImageProxyRequest({
            method: request.method ?? 'GET',
            body,
          }).then((proxyResponse) => {
            response.statusCode = proxyResponse.status;
            for (const [key, value] of Object.entries(proxyResponse.headers)) {
              response.setHeader(key, value);
            }
            response.end(proxyResponse.body);
          });
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), imageProxyPlugin()],
});
