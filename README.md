An [Obsidian](https://obsidian.md/) plugin that adds the functionality of a bibliography manager to your vault.

## Development

To work on this plugin, start by creating a new folder (e.g., `Obsidian bibliography`), and a brand new Obsidian vault in that folder (e.g., `sample-vault`).
Create a new folder in the vault to host the plugin:

```bash
mkdir sample-vault/.obsidian/plugins
```

Then, clone this repository in `Obsidian Bibliography` via

```bash
git clone -b plugin-main https://github.com/albertomercurio/Obsidian-Bibliography-Template.git obsidian-bibliography
```

and link the plugin to the vault via

```bash
cd sample-vault/.obsidian/plugins/
ln -s ../../../obsidian-bibliography/ obsidian-bibliography
```

Finally, install the dependencies and build the plugin by running

```bash
cd ../../../obsidian-bibliography
npm install
npm run dev
```

Now you can start Obsidian and open the `sample-vault` to see the plugin in action.
Remember that it is necessary to first enable the plugin in the settings under the "Community plugins" tab.

Any changes you make to the plugin code will be automatically reflected in the Obsidian instance upon refreshing the plugin (Ctrl+P -> "Reload app without saving").
Some changes might require a full restart of Obsidian to take effect.

### Development notes

Here is a quick overview of the plugin structure (the relevant files are in the `src` folder):

- `main.ts` is the entry point of the plugin, where it is initialized. 
Currently, it opens a connection to the IndexedDB database via the `DatabaseManager` class when the plugin is loaded, and closes it when the plugin is unloaded. Moreover, it sets up the commands and the views of the plugin.

- `utils.ts` contains utility functions that are used throughout the plugin.

- `constants.ts` contains all the constants used in the plugin.

- `random.ts` contains code to generate synthetic data for testing purposes.

- `databse/` contains all the code related to working with the IndexedDB database.

  - `DatabaseManager.ts` is the main class that handles the database connection and provides methods to interact with the database. When the connection to the database is established, it tries to load the existing bibliography data from the plugin folder. Otherwise, a clean database is created. When the connection is closed, the state of the databased is exported to the plugin folder.

  - `bibliographyDatabase.ts` implements the IndexedDB via the `Dexie` library. It defines the structure of the database and provides methods to load and save the bibliography data to the filesystem. If the database is brand new, it is populated with some example data for testing purposes.

  - `entry.ts` defines the structure of a bibliography entry and provides several subclasses for different types of entries (e.g., books, articles, etc.).

- `views/` contains all the code related to the user interface of the plugin.

  - `BibliographyListView.ts` contains the code for displaying the list of bibliography entries in the editor area. Currently, it only displays a list of numbers, but it will be extended to show the actual entries.