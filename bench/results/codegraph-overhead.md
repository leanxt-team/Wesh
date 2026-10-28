# Code graph overhead in the prompt (o200k (js-tiktoken))

| what the model reads          | tokens without codegraph | with codegraph | codegraph adds |
|-------------------------------|-------------------------:|---------------:|---------------:|
| system prompt (rules, skills) |                     4184 |           4486 |           +302 |
| tool definitions              |                     3922 |           4290 |           +368 |
| total per request             |                     8106 |           8776 |           +670 |

Measured on the real OpenCode opencode v2.2.0 request the mock model receives (stress test 7),
with and without codegraph wired. The tool definitions include codegraph's own server instructions.
