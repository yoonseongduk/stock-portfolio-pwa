"""Sprint 0용 임시 아이콘 생성 스크립트.
PIL로 상승 막대그래프 모양의 단색 아이콘을 만든다. 디자인은 나중에 바꿔도 된다.
사용법: py -3 make_icons.py
"""
from PIL import Image, ImageDraw

BG = (20, 83, 45)       # 짙은 녹색 (증가 느낌)
BAR = (240, 240, 240)   # 밝은 회색/흰색 막대


def draw_icon(size, padding_ratio):
    img = Image.new("RGB", (size, size), BG)
    draw = ImageDraw.Draw(img)

    pad = int(size * padding_ratio)
    usable = size - pad * 2
    bar_w = usable // 5

    heights = [0.35, 0.55, 0.45, 0.75, 0.95]
    gap = bar_w // 2
    total_w = len(heights) * bar_w + (len(heights) - 1) * gap
    start_x = pad + (usable - total_w) // 2
    baseline = size - pad

    x = start_x
    for h_ratio in heights:
        bar_h = int(usable * h_ratio)
        draw.rectangle(
            [x, baseline - bar_h, x + bar_w, baseline],
            fill=BAR,
        )
        x += bar_w + gap

    return img


icon_192 = draw_icon(192, padding_ratio=0.12)
icon_192.save("icon-192.png")

icon_512 = draw_icon(512, padding_ratio=0.12)
icon_512.save("icon-512.png")

# maskable: 안전 영역을 더 넉넉히 둬서 원형/둥근 사각형으로 잘려도 안 잘리게
icon_512_maskable = draw_icon(512, padding_ratio=0.22)
icon_512_maskable.save("icon-512-maskable.png")

print("아이콘 3개 생성 완료: icon-192.png, icon-512.png, icon-512-maskable.png")
