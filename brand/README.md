# Source artwork

Put the icon here as `icon-source.png` and run:

    python3 tools/make-icons.py --source brand/icon-source.png

Best if it is:

- **square**, 1024×1024 or larger
- **no rounded corners** — both stores round it themselves, and corners baked
  into the file get cut twice and come out looking chipped
- **full bleed** — art to the edges, no margin. Android's adaptive icon crops a
  circle out of the middle, so any margin in the file is margin you lose twice
- **no transparency** for the iOS copy; Apple rejects an icon with an alpha
  channel, so it is flattened on the way through

None of that has to be true of the file you drop in — the generator fixes what
it can and says what it cannot.
