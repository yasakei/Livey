require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const querystring = require('querystring');
const cookieParser = require('cookie-parser');

const spotify_client_id = process.env.SPOTIFY_CLIENT_ID;
const spotify_client_secret = process.env.SPOTIFY_CLIENT_SECRET;
const spotify_redirect_uri = process.env.SPOTIFY_REDIRECT_URI;

let access_token = '';
let refresh_token = '';

const server = http.createServer((req, res) => {
    // Use cookie parser middleware
    cookieParser()(req, res, () => {});

    if (req.url === '/login') {
        const scope = 'user-read-currently-playing';
        const auth_query_parameters = new URLSearchParams({
            response_type: 'code',
            client_id: spotify_client_id,
            scope: scope,
            redirect_uri: spotify_redirect_uri,
        });
        res.writeHead(302, { 'Location': 'https://accounts.spotify.com/authorize/?' + auth_query_parameters.toString() });
        res.end();
    } else if (req.url.startsWith('/callback')) {
        const code = new URL(req.url, `http://${req.headers.host}`).searchParams.get('code') || null;

        axios({
            method: 'post',
            url: 'https://accounts.spotify.com/api/token',
            data: querystring.stringify({
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: spotify_redirect_uri
            }),
            headers: {
                'content-type': 'application/x-www-form-urlencoded',
                'Authorization': 'Basic ' + (Buffer.from(spotify_client_id + ':' + spotify_client_secret).toString('base64'))
            },
        }).then(response => {
            if (response.status === 200) {
                access_token = response.data.access_token;
                refresh_token = response.data.refresh_token;
                res.writeHead(302, { 'Location': '/' });
                res.end();
            } else {
                res.writeHead(response.status);
                res.end(response.statusText);
            }
        }).catch(error => {
            res.writeHead(500);
            res.end(error.toString());
        });
    } else if (req.url === '/currently-playing') {
        if (!access_token) {
            res.writeHead(401);
            res.end('Not authorized. Please login first.');
            return;
        }
        axios.get('https://api.spotify.com/v1/me/player/currently-playing', {
            headers: {
                'Authorization': 'Bearer ' + access_token
            }
        }).then(response => {
            if (response.status === 200 && response.data) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(response.data));
            } else if (response.status === 204) {
                res.writeHead(204); // No content
                res.end();
            }
            else {
                res.writeHead(response.status);
                res.end(response.statusText);
            }
        }).catch(error => {
            // If the access token is expired, try to refresh it.
            if (error.response && error.response.status === 401) {
                axios({
                    method: 'post',
                    url: 'https://accounts.spotify.com/api/token',
                    data: querystring.stringify({
                        grant_type: 'refresh_token',
                        refresh_token: refresh_token,
                    }),
                    headers: {
                        'content-type': 'application/x-www-form-urlencoded',
                        'Authorization': 'Basic ' + (Buffer.from(spotify_client_id + ':' + spotify_client_secret).toString('base64')),
                    },
                }).then(response => {
                    access_token = response.data.access_token;
                    // Retry the currently-playing request
                    res.writeHead(307, { 'Location': '/currently-playing' });
                    res.end();
                }).catch(refresh_error => {
                    res.writeHead(401);
                    res.end('Could not refresh token. Please login again.');
                });
            } else {
                res.writeHead(500);
                res.end(error.toString());
            }
        });
    } else {
        // Serve static files
        let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
        const safePath = path.normalize(filePath).replace(/^(\.\.["\\\\])+/, '');
        if (!safePath.startsWith(__dirname)) {
            res.writeHead(403);
            res.end('Forbidden');
            return;
        }

        const extname = String(path.extname(safePath)).toLowerCase();
        const mimeTypes = {
            '.html': 'text/html',
            '.js': 'text/javascript',
            '.css': 'text/css',
            '.gif': 'image/gif',
        };
        const contentType = mimeTypes[extname] || 'application/octet-stream';

        fs.readFile(safePath, (error, content) => {
            if (error) {
                if (error.code === 'ENOENT') {
                    res.writeHead(404);
                    res.end('File not found');
                } else {
                    res.writeHead(500);
                    res.end(`Server Error: ${error.code}`);
                }
            } else {
                res.writeHead(200, { 'Content-Type': contentType });
                res.end(content, 'utf-8');
            }
        });
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
