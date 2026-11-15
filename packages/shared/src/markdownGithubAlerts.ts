interface MarkdownAstNode {
  type?: string;
  value?: unknown;
  data?: {
    hProperties?: Record<string, unknown>;
  };
  children?: MarkdownAstNode[];
}

// Fork: SUCCESS, NEXT and REPLIES extend GitHub's set, and text after the marker becomes the title.
const GITHUB_ALERT_MARKER =
  /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|SUCCESS|NEXT|REPLIES)\](?:[ \t]+([^\r\n]*))?(?:\r?\n|$)/i;

function readGithubAlert(node: MarkdownAstNode): void {
  if (node.type !== "blockquote") return;
  const paragraph = node.children?.[0];
  const text = paragraph?.children?.[0];
  if (paragraph?.type !== "paragraph" || text?.type !== "text" || typeof text.value !== "string") {
    return;
  }
  const match = GITHUB_ALERT_MARKER.exec(text.value);
  if (!match?.[1]) return;

  // An empty remainder may have next-line sibling content; preserve whether the marker ended its line.
  const markerEndsItsLine = match[0].endsWith("\n");
  const titleText = match[2];
  // A title only counts when the whole line is plain text; formatted text stays in the body.
  const hasTitle =
    titleText !== undefined && (markerEndsItsLine || paragraph.children?.length === 1);
  const title = hasTitle ? titleText.trim() : "";
  const remainder =
    titleText !== undefined && !hasTitle
      ? text.value.slice(match[0].length - titleText.length)
      : text.value.slice(match[0].length);
  if (remainder.length > 0) {
    text.value = remainder;
  } else if (markerEndsItsLine || paragraph.children?.length === 1) {
    paragraph.children?.shift();
    if (paragraph.children?.length === 0) {
      node.children?.shift();
    }
  } else {
    return;
  }

  node.data = {
    ...node.data,
    hProperties: {
      ...node.data?.hProperties,
      dataAlert: match[1].toLowerCase(),
      ...(title ? { dataAlertTitle: title } : {}),
    },
  };
}

export function remarkGithubAlerts() {
  return (tree: MarkdownAstNode) => {
    const visit = (node: MarkdownAstNode) => {
      node.children?.forEach(visit);
      readGithubAlert(node);
    };
    visit(tree);
  };
}
