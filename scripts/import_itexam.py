from __future__ import annotations

import hashlib
import html
import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen


QUIZ_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = QUIZ_ROOT / "data"
ASSET_DIR = QUIZ_ROOT / "assets" / "exhibits"
OUTPUT_FILE = DATA_DIR / "question-bank.js"

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0 Safari/537.36"
)

QUESTION_START_RE = re.compile(r"(?is)<p[^>]*>\s*<(?:strong|b)>\s*(\d+)\.")
DIV_TAG_RE = re.compile(r"(?is)</?div\b[^>]*>")
IMAGE_TAG_RE = re.compile(r"(?is)<img\b[^>]*\bsrc=['\"]([^'\"]+)['\"][^>]*>")
LIST_BLOCK_RE = re.compile(r"(?is)<(ul|ol)\b[^>]*>(.*?)</\1>")
LIST_ITEM_RE = re.compile(r"(?is)<li\b([^>]*)>(.*?)</li>")
QUESTION_PREFIX_RE = re.compile(
    r"(?is)^(\s*<p[^>]*>\s*<(?:strong|b)>)\s*\d+\.\s*",
)
MESSAGE_BOX_START_RE = re.compile(
    r"(?is)<div[^>]*class=['\"][^'\"]*\bmessage_box\b[^'\"]*['\"][^>]*>",
)
MULTI_SELECT_RE = re.compile(r"(?i)\b(choose|select)\s+(two|three|four)\b")
BLOCK_BREAK_RE = re.compile(r"(?i)</(p|div|li|tr|pre|table|ul|ol|h\d)>")
TAG_RE = re.compile(r"(?is)<[^>]+>")


@dataclass(frozen=True)
class SourcePage:
    module_id: str
    module_label: str
    module_short_label: str
    url: str
    accent: str


SOURCES = [
    SourcePage(
        module_id="ccna2-m1-4",
        module_label="CCNA 2 Modules 1-4: Switching Concepts, VLANs, and InterVLAN Routing",
        module_short_label="Modules 1-4",
        url="https://itexamanswers.net/ccna-2-v7-modules-1-4-switching-concepts-vlans-and-intervlan-routing-exam-answers.html",
        accent="#2563eb",
    ),
    SourcePage(
        module_id="ccna2-m5-6",
        module_label="CCNA 2 Modules 5-6: Redundant Networks",
        module_short_label="Modules 5-6",
        url="https://itexamanswers.net/ccna-2-v7-modules-5-6-redundant-networks-exam-answers.html",
        accent="#7c3aed",
    ),
    SourcePage(
        module_id="ccna2-m7-9",
        module_label="CCNA 2 Modules 7-9: Available and Reliable Networks",
        module_short_label="Modules 7-9",
        url="https://itexamanswers.net/ccna-2-v7-modules-7-9-available-and-reliable-networks-exam-answers.html",
        accent="#0d9488",
    ),
    SourcePage(
        module_id="ccna2-m10-13",
        module_label="CCNA 2 Modules 10-13: L2 Security and WLANs",
        module_short_label="Modules 10-13",
        url="https://itexamanswers.net/ccna-2-v7-modules-10-13-l2-security-and-wlans-exam-answers.html",
        accent="#0f766e",
    ),
    SourcePage(
        module_id="ccna2-m14-16",
        module_label="CCNA 2 Modules 14-16: Routing Concepts and Configuration",
        module_short_label="Modules 14-16",
        url="https://itexamanswers.net/ccna-2-v7-modules-14-16-routing-concepts-and-configuration-exam-answers.html",
        accent="#b45309",
    ),
    SourcePage(
        module_id="ccna1-final-practice",
        module_label="CCNA 1 Version 7.00: ITNv7 Practice Final Exam",
        module_short_label="CCNA1 Final",
        url="https://itexamanswers.net/ccna-1-version-7-00-itnv7-practice-final-exam-answers.html",
        accent="#dc2626",
    ),
]


def fetch_bytes(url: str) -> bytes:
    request = Request(url, headers={"User-Agent": USER_AGENT})
    with urlopen(request, timeout=45) as response:
        return response.read()


def fetch_text(url: str) -> str:
    return fetch_bytes(url).decode("utf-8", errors="ignore")


def extract_balanced_block(markup: str, open_match: re.Match[str], tag_name: str) -> tuple[str, int]:
    tag_re = re.compile(fr"(?is)</?{tag_name}\b[^>]*>")
    depth = 1
    for tag_match in tag_re.finditer(markup, open_match.end()):
        if tag_match.group(0).lower().startswith(f"</{tag_name}"):
            depth -= 1
        else:
            depth += 1

        if depth == 0:
            return markup[open_match.start() : tag_match.end()], tag_match.end()

    raise ValueError(f"Unbalanced <{tag_name}> block")


def extract_entry_content(page_html: str) -> str:
    entry_match = re.search(
        r"(?is)<div[^>]*class=['\"][^'\"]*\bentry-content\b[^'\"]*['\"][^>]*>",
        page_html,
    )
    if not entry_match:
        raise ValueError("Could not find entry-content block")

    block_html, _ = extract_balanced_block(page_html, entry_match, "div")
    inner_match = re.match(r"(?is)<div\b[^>]*>(.*)</div>\s*$", block_html)
    if not inner_match:
        raise ValueError("Could not isolate entry-content inner HTML")

    return inner_match.group(1)


def split_question_chunks(entry_html: str) -> list[tuple[int, str]]:
    matches = list(QUESTION_START_RE.finditer(entry_html))
    chunks: list[tuple[int, str]] = []

    for index, match in enumerate(matches):
        start = match.start()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(entry_html)
        chunks.append((int(match.group(1)), entry_html[start:end].strip()))

    return chunks


def extract_message_box(chunk_html: str) -> tuple[str, str]:
    message_match = MESSAGE_BOX_START_RE.search(chunk_html)
    if not message_match:
        return chunk_html.strip(), ""

    block_html, _ = extract_balanced_block(chunk_html, message_match, "div")
    inner_match = re.match(r"(?is)<div\b[^>]*>(.*)</div>\s*$", block_html)
    inner_html = inner_match.group(1).strip() if inner_match else ""
    body_html = chunk_html[: message_match.start()].strip()
    return body_html, inner_html


def html_to_text(fragment: str) -> str:
    text = BLOCK_BREAK_RE.sub("\n", fragment)
    text = re.sub(r"(?is)<br\s*/?>", "\n", text)
    text = TAG_RE.sub("", text)
    text = html.unescape(text)
    lines = [" ".join(part.split()) for part in text.splitlines()]
    cleaned = "\n".join(line for line in lines if line)
    return cleaned.strip()


def normalize_fragment(fragment: str) -> str:
    cleaned = fragment.replace("\u200b", "")
    cleaned = re.sub(r"(?is)<script\b.*?</script>", "", cleaned)
    cleaned = re.sub(r"(?is)<style\b.*?</style>", "", cleaned)
    cleaned = cleaned.replace("\r", "")
    return cleaned.strip()


def strip_question_number(fragment: str) -> str:
    return QUESTION_PREFIX_RE.sub(r"\1", fragment, count=1).strip()


def strip_explanation_label(fragment: str) -> str:
    cleaned = re.sub(
        r"(?is)^\s*<p[^>]*>\s*<(?:strong|b)>\s*Explanation:\s*</(?:strong|b)>\s*",
        "<p>",
        fragment,
        count=1,
    )
    return cleaned.strip()


def split_study_solution(fragment: str) -> tuple[str, str]:
    markers = [
        re.compile(
            r"(?is)<p[^>]*>\s*<(?:strong|b)>\s*Place the options in the following order\.",
        ),
        re.compile(r"(?is)<p[^>]*>\s*<(?:strong|b)>\s*Use the drop-down"),
        re.compile(r"(?is)<p[^>]*>\s*<(?:strong|b)>\s*Select from the drop-down"),
    ]

    for marker in markers:
        match = marker.search(fragment)
        if match:
            return fragment[: match.start()].strip(), fragment[match.start() :].strip()

    table_index = fragment.lower().find("<table")
    if table_index != -1:
        return fragment[:table_index].strip(), fragment[table_index:].strip()

    return fragment.strip(), ""


def download_asset(
    asset_url: str,
    source: SourcePage,
    question_number: int,
    ordinal: int,
    cache: dict[str, str],
) -> str:
    if asset_url in cache:
        return cache[asset_url]

    parsed = urlparse(asset_url)
    extension = Path(parsed.path).suffix.lower()
    if extension not in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}:
        extension = ".jpg"

    file_hash = hashlib.sha1(asset_url.encode("utf-8")).hexdigest()[:10]
    module_dir = ASSET_DIR / source.module_id
    module_dir.mkdir(parents=True, exist_ok=True)
    file_path = module_dir / f"q{question_number:03d}-{ordinal + 1}-{file_hash}{extension}"

    if not file_path.exists():
        file_path.write_bytes(fetch_bytes(asset_url))

    relative_path = file_path.relative_to(QUIZ_ROOT).as_posix()
    cache[asset_url] = relative_path
    return relative_path


def localize_images(
    fragment: str,
    source: SourcePage,
    question_number: int,
    cache: dict[str, str],
) -> tuple[str, list[str]]:
    localized_paths: list[str] = []
    ordinal = 0

    def replace_image(match: re.Match[str]) -> str:
        nonlocal ordinal
        full_tag = match.group(0)
        src = html.unescape(match.group(1).strip())
        absolute_url = urljoin(source.url, src)

        try:
            localized_src = download_asset(absolute_url, source, question_number, ordinal, cache)
        except Exception:
            localized_src = absolute_url

        alt_match = re.search(r"(?is)\balt=['\"]([^'\"]*)['\"]", full_tag)
        alt_text = html.escape(alt_match.group(1).strip() if alt_match else f"Exhibit Q{question_number}")
        localized_paths.append(localized_src)
        ordinal += 1
        return f'<img src="{localized_src}" alt="{alt_text}" />'

    updated_fragment = IMAGE_TAG_RE.sub(replace_image, fragment)
    return updated_fragment, localized_paths


def parse_options(fragment: str) -> list[dict[str, Any]]:
    options: list[dict[str, Any]] = []
    alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"

    for index, item_match in enumerate(LIST_ITEM_RE.finditer(fragment)):
        attrs = item_match.group(1) or ""
        inner_html = item_match.group(2).strip()
        option_text = html_to_text(inner_html)
        if not option_text:
            continue

        item_marker = f"{attrs} {inner_html}".lower()
        is_correct = (
            "correct_answer" in item_marker
            or "#ff0000" in item_marker
            or "color: red" in item_marker
        )
        options.append(
            {
                "id": alphabet[index],
                "text": option_text,
                "isCorrect": is_correct,
            }
        )

    return options


def parse_question(
    source: SourcePage,
    question_number: int,
    chunk_html: str,
    asset_cache: dict[str, str],
) -> dict[str, Any]:
    body_html, explanation_html = extract_message_box(chunk_html)

    option_block_match = LIST_BLOCK_RE.search(body_html)
    option_list: list[dict[str, Any]] = []
    solution_html = ""

    if option_block_match:
        prompt_html = body_html[: option_block_match.start()].strip()
        option_list = parse_options(option_block_match.group(2))
        prompt_text_before_options = html_to_text(strip_question_number(prompt_html)).lower()
        has_marked_answer = any(option["isCorrect"] for option in option_list)

        if option_list and not has_marked_answer and prompt_text_before_options.startswith(
            "place the options in the following order",
        ):
            solution_html = option_block_match.group(0).strip()
            option_list = []
    else:
        prompt_html, solution_html = split_study_solution(body_html)

    prompt_html = normalize_fragment(strip_question_number(prompt_html))
    solution_html = normalize_fragment(solution_html)
    explanation_html = normalize_fragment(strip_explanation_label(explanation_html))

    prompt_html, prompt_images = localize_images(prompt_html, source, question_number, asset_cache)
    solution_html, solution_images = localize_images(solution_html, source, question_number, asset_cache)
    explanation_html, explanation_images = localize_images(
        explanation_html,
        source,
        question_number,
        asset_cache,
    )

    correct_ids = [option["id"] for option in option_list if option["isCorrect"]]
    prompt_text = html_to_text(prompt_html)

    if option_list:
        question_type = "multiple" if len(correct_ids) > 1 or MULTI_SELECT_RE.search(prompt_text) else "single"
    else:
        question_type = "study"

    return {
        "id": f"{source.module_id}-q{question_number:03d}",
        "moduleId": source.module_id,
        "moduleLabel": source.module_label,
        "moduleShortLabel": source.module_short_label,
        "questionNumber": question_number,
        "type": question_type,
        "promptHtml": prompt_html,
        "promptText": prompt_text,
        "options": [
            {
                "id": option["id"],
                "text": option["text"],
            }
            for option in option_list
        ],
        "correctOptionIds": correct_ids,
        "solutionHtml": solution_html,
        "explanationHtml": explanation_html,
        "sourceUrl": source.url,
        "assetPaths": prompt_images + solution_images + explanation_images,
    }


def build_question_bank() -> dict[str, Any]:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    ASSET_DIR.mkdir(parents=True, exist_ok=True)

    asset_cache: dict[str, str] = {}
    questions: list[dict[str, Any]] = []
    modules: list[dict[str, Any]] = []

    for source in SOURCES:
        page_html = fetch_text(source.url)
        entry_html = extract_entry_content(page_html)
        chunks = split_question_chunks(entry_html)

        module_questions = [
            parse_question(source, question_number, chunk_html, asset_cache)
            for question_number, chunk_html in chunks
        ]

        questions.extend(module_questions)
        modules.append(
            {
                "id": source.module_id,
                "label": source.module_label,
                "shortLabel": source.module_short_label,
                "accent": source.accent,
                "questionCount": len(module_questions),
                "sourceUrl": source.url,
            }
        )

    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sources": [
            {
                "id": source.module_id,
                "label": source.module_label,
                "url": source.url,
            }
            for source in SOURCES
        ],
        "modules": modules,
        "questionCount": len(questions),
        "questions": questions,
    }


def write_question_bank(question_bank: dict[str, Any]) -> None:
    payload = "window.QUIZ_BANK = " + json.dumps(question_bank, ensure_ascii=False, indent=2) + ";\n"
    OUTPUT_FILE.write_text(payload, encoding="utf-8")


def main() -> None:
    question_bank = build_question_bank()
    write_question_bank(question_bank)
    print(
        f"Generated {question_bank['questionCount']} questions "
        f"across {len(question_bank['modules'])} modules at {OUTPUT_FILE}",
    )


if __name__ == "__main__":
    main()
