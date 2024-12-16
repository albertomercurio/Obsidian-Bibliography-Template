An [Obsidian](https://obsidian.md/) plugin that adds the functionality of a bibliography manager to your vault. 

---

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
