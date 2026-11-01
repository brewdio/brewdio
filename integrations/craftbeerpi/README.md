# cbpi4-brewdio

CraftBeerPi 4 plugin that reads recipes from Brewdio's authenticated Recipe API and
creates managed recipe files in CraftBeerPi's normal recipe book.

The plugin only writes files named `brewdio_<recipe-id>.yaml`. It does not modify
ordinary CraftBeerPi recipes, start a brew, create a Brewdio batch, or change inventory.

Copy `settings.example.json` to CraftBeerPi's config directory as `brewdio.json`, fill
in the local server URL, API key, kettle ID and sensor ID, and restrict the file to its
owner (`0600`). Never commit `brewdio.json`.

On the SammyBreew installation, run `configure.py` in a terminal to paste the API key
without showing it on screen or storing it in shell history.
