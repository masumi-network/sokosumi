import { extractFileLikeLinks } from "@sokosumi/utils";

const memeMarkdown = `
The agent is now working on your task. Please check back soon.

# **Your Memes**

### Meme 1
![Meme 1](https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20260108_001718_Apple_vs_Google_1.png)
[Download](https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20260108_001718_Apple_vs_Google_1.png)

### Meme 2
![Meme 2](https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20260108_001718_Apple_vs_Google_2.png)
[Download](https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20260108_001718_Apple_vs_Google_2.png)

### Meme 3
![Meme 3](https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20260108_001718_Apple_vs_Google_3.png)
[Download](https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20260108_001718_Apple_vs_Google_3.png)

### Meme 4
![Meme 4](https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20260108_001718_Apple_vs_Google_4.png)
[Download](https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20260108_001718_Apple_vs_Google_4.png)

### Meme 5
![Meme 5](https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20260108_001718_Apple_vs_Google_5.png)
[Download](https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20260108_001718_Apple_vs_Google_5.png)

### Meme 6
![Meme 6](https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20260108_001718_Apple_vs_Google_6.png)
[Download](https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20260108_001718_Apple_vs_Google_6.png)

### Meme 7
![Meme 7](https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20260108_001718_Apple_vs_Google_7.png)
[Download](https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20260108_001718_Apple_vs_Google_7.png)

### Meme 8
![Meme 8](https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20260108_001718_Apple_vs_Google_8.png)
[Download](https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20260108_001718_Apple_vs_Google_8.png)

### Meme 9
![Meme 9](https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20260108_001718_Apple_vs_Google_9.png)
[Download](https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20260108_001718_Apple_vs_Google_9.png)

### Meme 10
![Meme 10](https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20260108_001718_Apple_vs_Google_10.png)
[Download](https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20260108_001718_Apple_vs_Google_10.png)
`;

describe("extractFileLikeLinks", () => {
  it("extracts 10 unique file-like URLs from meme markdown", () => {
    const fileLinks = extractFileLikeLinks(memeMarkdown);
    const expected = [
      "https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20260108_001718_Apple_vs_Google_1.png",
      "https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20260108_001718_Apple_vs_Google_2.png",
      "https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20260108_001718_Apple_vs_Google_3.png",
      "https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20260108_001718_Apple_vs_Google_4.png",
      "https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20260108_001718_Apple_vs_Google_5.png",
      "https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20260108_001718_Apple_vs_Google_6.png",
      "https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20260108_001718_Apple_vs_Google_7.png",
      "https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20260108_001718_Apple_vs_Google_8.png",
      "https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20260108_001718_Apple_vs_Google_9.png",
      "https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20260108_001718_Apple_vs_Google_10.png",
    ];

    const unique = new Set(fileLinks);
    expect(unique.size).toBe(10);
    expected.forEach((url) => {
      expect(unique.has(url)).toBe(true);
    });
  });
});
