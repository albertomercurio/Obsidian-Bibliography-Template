import * as path from "path";

const isValidRelativePath = (path: string): boolean => {
	const invalidPathRegex = /^(?!\/|~).*[^ <>:"|?*\x00-\x1F]$/;

	if (!invalidPathRegex.test(path)) {
		return false;
	}

	if (path.includes("//")) {
		return false;
	}

	if (path.startsWith("./")) {
		path = path.slice(2);
	}

	const pathSegments = path.split("/");
	let descent = 0;

	for (const segment of pathSegments) {
		if (segment === "..") {
			descent--;
			if (descent < 0) {
				return false;
			}
			continue;
		}
		if (segment.includes(".")) {
			return false;
		}
		descent++;
	}

	return true;
};

const getCompactRelativePath = (relPath: string): string => {
	relPath = path.normalize(relPath);

	if (relPath.startsWith("./")) {
		relPath = relPath.slice(2);
	}

	if (relPath.endsWith("/")) {
		relPath = relPath.slice(0, -1);
	}

	return relPath;
};

const isDoi = (doi: string) => {
	doi = doi.trim();
	return /^10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+$/.test(doi);
}

const isDoiUrl = (doi: string) => {
	doi = doi.trim();
	return /^https?:\/\/(dx\.)?doi\.org\/10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+$/.test(
		doi
	);
}

const isDoiOrUrl = (doi: string) => {
	return isDoi(doi) || isDoiUrl(doi);
}

export { isValidRelativePath, getCompactRelativePath, isDoi, isDoiUrl, isDoiOrUrl };
