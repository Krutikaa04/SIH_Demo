

\# Frontend Distribution Policy



\## Decision



The `frontend/dist/` directory is generated build output and is no longer committed to Git.



The frontend is built with Vite using `npm run build`. CI builds the frontend and publishes it as an artifact. Version releases include a portable offline demo bundle containing the built frontend.



\## Development workflow



1\. Install Node.js 20 or newer.

2\. Run `npm ci` inside `frontend/`.

3\. Make UI changes and verify them with `npm run build`.

4\. Do not commit files generated inside `frontend/dist/`.

5\. Open a pull request with source changes only.



\## CI and releases



CI builds the frontend and uploads the generated `dist/` directory as an artifact.



When a version tag is published, the release workflow builds the portable demo bundle and attaches it to the GitHub Release.



\## Running the demo



The offline demo bundle includes `frontend/dist/` and can run on a demo laptop with Python and the bundled Python dependencies. Node.js is not required on that laptop.



A fresh source checkout requires Node.js to build the frontend before running the demo.



\## Bundle generation



Run the following command from the repository root on Windows:



`powershell -ExecutionPolicy Bypass -File scripts\\make\_bundle.ps1`



The script verifies that the built frontend exists, builds it when necessary, and packages the project for offline use.



\## Migration



After this policy is merged, contributors should pull the latest `master`. If their local `frontend/dist/` files are removed during the update, they can regenerate them with `npm ci` and `npm run build` inside `frontend/`.



