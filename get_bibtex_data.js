class BibTexParser {
    constructor(bibtexString) {
        this.bibtexString = bibtexString;
        this.parsedData = this.parseEntry();
    }
  
    static parseAuthors(authorString) {
      const particles = ['di', 'de', 'de la', 'der', 'van', 'von', 'della', 'du', 'zu', 'zum', 'zur'];
  
      return authorString.split(' and ').map(author => {
        if (author.includes(',')) {
          const parts = author.split(',').map(s => s.trim());
          if (parts.length === 2) {
            const [lastName, firstName] = parts;
            return { lastName, firstName };
          } else if (parts.length === 3) {
            const [vonLast, jr, firstName] = parts;
            return { lastName: vonLast, firstName, jr };
          }
        } else {
          // const nameParts = author.split(' ');
          const nameParts = author.split(' ').filter(part => part.trim() !== '');
          const lastName = nameParts.pop();
          let vonPart = '';
  
          // Check if there are any particles in the name
          if (nameParts.length > 0) {
            const potentialParticle = nameParts[nameParts.length - 1].toLowerCase();
            if (particles.includes(potentialParticle)) {
                vonPart = nameParts.pop();
            }
          }
          const firstName = nameParts.join(' ');
  
          // Combine vonPart (if any) with lastName
          return { firstName, lastName: vonPart ? `${vonPart} ${lastName}` : lastName };
        }
      });
    }
  
    // parseEntry() {
    //   const typeMatch = this.bibtexString.match(/\s*@([a-zA-Z]+)\{/);
    //   const type = typeMatch ? typeMatch[1].toLowerCase() : '';
    //   const fields = {};
    //   // const regex = /(\w+)\s*=\s*\{((?:[^{}]|{(?:[^{}]|{[^{}]*})*})*)\},/gs;  // Handles nested braces
    //   const regex = /(\w+)\s*=\s*\{((?:[^{}]|{(?:[^{}]|{[^{}]*})*})*)\}(?:,|(?=\n*\}$))/gs; // Handles nested braces (The most complete)
    //   // const regex = /(\w+)\s*=\s*\{([^}]*)\}/g;
  
    //   let match;
  
    //   while ((match = regex.exec(this.bibtexString)) !== null) {
    //     const [_, field, _value] = match;
    //     const value = this.cleanBraces(_value);
    //     console.log(field, value);
    //     if (field === 'author') {
    //       this.parsedAuthors = BibTexParser.parseAuthors(LaTeXtoUTF8(value)); // Store parsed authors separately
    //       fields.author = value; // Store the original author string for BibTeX export
    //     } else {
    //       fields[field] = value;
    //     }
    //   }
  
    //   fields.type = type.toLowerCase();
  
    //   return fields;
    // }
  
    parseEntry() {
      const typeMatch = this.bibtexString.match(/\s*@([a-zA-Z]+)\{/);
      const type = typeMatch ? typeMatch[1].toLowerCase() : '';
      const fields = {};
      const regex = /(\w+)\s*=\s*\{/g; // Match field = {
      let match;
  
      while ((match = regex.exec(this.bibtexString)) !== null) {
        const field = match[1];
        const value = this.cleanOuterBraces(this.extractValue(regex.lastIndex - 1)); // Start parsing the value
        if (field === 'author') {
          this.parsedAuthors = BibTexParser.parseAuthors(removeCurlyBraces(LaTeXtoUTF8(value))); // Parse authors if applicable
          fields.author = value; // Store original author string
        } else {
          fields[field] = value;
        }
      }
  
      fields.type = type.toLowerCase();
      return fields;
      }
  
    cleanOuterBraces(text) {
      let cleaned = text;
      while (cleaned.startsWith('{') && cleaned.endsWith('}')) {
        cleaned = cleaned.slice(1, -1);
      }
      return cleaned;
    }
  
    extractValue(startIndex) {
      let braceCount = 0;
      let value = '';
      let insideCurly = false;
  
      for (let i = startIndex; i < this.bibtexString.length; i++) {
        const char = this.bibtexString[i];
        if (char === '{') {
          braceCount++;
          insideCurly = true;
        } else if (char === '}') {
          braceCount--;
          if (braceCount === 0) {
            insideCurly = false;
            break;
          }
        }
        if (insideCurly) {
          value += char;
        }
      }
      return value.slice(1); // Remove the first curly brace
    }
  
    generateCitationKey() {
      const author = this.parsedAuthors && this.parsedAuthors.length > 0 ? removeSpaces(removeAccents(this.parsedAuthors[0].lastName)) : 'Unknown';
      const year = this.parsedData.year || 'Unknown';
      const firstWordTitle = this.parsedData.title ? removeCurlyBraces(removeSpaces(removeAccents(this.parsedData.title.split(' ')[0]))) : 'Unknown';
      return `${author}${year}${firstWordTitle}`;
    }
  
    toBibTex() {
      const citationKey = this.generateCitationKey();
      const fields = Object.entries(this.parsedData)
        .filter(([key]) => key !== 'type')
        .map(([key, value]) => {
          if (key === 'title') {
            return `${key} = {{${value}}}`; // Use double curly braces for title
          }
          return `${key} = {${value}}`;
        });
  
      return `@${this.parsedData.type}{${citationKey},\n  ${fields.join(',\n  ')}}`;
    }
  
    getAuthorsYAML() {
      if (!this.parsedAuthors || this.parsedAuthors.length === 0) {
        return '';
      }
      return this.parsedAuthors
        .map(author => ` - ${author.lastName} ${author.firstName}`)
        .join('\n');
    }
  
    getTitle_UTF8() {
      return LaTeXtoUTF8(this.parsedData.title);
    }
}

async function getBibtexFromDOI(doi) {
  const url = `https://doi.org/${doi}`;
  try {
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/x-bibtex'
      }
    });
    if (response.ok) {
      const bibtex = await response.text();
      const parser = new BibTexParser(bibtex);
      return parser;
    } else {
      throw new Error(`Error fetching BibTeX: ${response.statusText}`);
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

function removeCurlyBraces(str) {
  return str.replace(/[{}]/g, '');
}

function removeSpaces(str) {
  return str.replace(/\s+/g, '');
}

function removeAccents(str) {
  // Normalize the string to decompose accented characters into base characters and combining diacritics
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // Remove combining diacritics
}

function LaTeXtoUTF8(latex_string) {
  // A mapping from LaTeX commands to their corresponding Unicode characters
  const latex2utf8 = {
      // Accents
      "\\`{a}": "à", "\\'{a}": "á", "\\\"{a}": "ä", "\\^{a}": "â", "\\~{a}": "ã", "\\={a}": "ā",
      "\\`a": "à", "\\'a": "á", "\\\"a": "ä", "\\^a": "â", "\\~a": "ã", "\\=a": "ā",
      "\\`{e}": "è", "\\'{e}": "é", "\\\"{e}": "ë", "\\^{e}": "ê", "\\={e}": "ē",
      "\\`e": "è", "\\'e": "é", "\\\"e": "ë", "\\^e": "ê", "\\=e": "ē",
      "\\`{i}": "ì", "\\'{i}": "í", "\\\"{i}": "ï", "\\^{i}": "î", "\\={i}": "ī", 
      "\\`i": "ì", "\\'i": "í", "\\\"i": "ï", "\\^i": "î", "\\=i": "ī",
      "\\`{\\i}": "ì", "\\'{\\i}": "í", "\\\"{\\i}": "ï", "\\^{\\i}": "î",  // Handle dotless \i
      "\\`{o}": "ò", "\\'{o}": "ó", "\\\"{o}": "ö", "\\^{o}": "ô", "\\~{o}": "õ", "\\={o}": "ō",
      "\\`o": "ò", "\\'o": "ó", "\\\"o": "ö", "\\^o": "ô", "\\~o": "õ", "\\=o": "ō",
      "\\`{u}": "ù", "\\'{u}": "ú", "\\\"{u}": "ü", "\\^{u}": "û", "\\={u}": "ū",
      "\\`u": "ù", "\\'u": "ú", "\\\"u": "ü", "\\^u": "û", "\\=u": "ū",
      "\\`{A}": "À", "\\'{A}": "Á", "\\\"{A}": "Ä", "\\^{A}": "Â", "\\~{A}": "Ã",
      "\\`A": "À", "\\'A": "Á", "\\\"A": "Ä", "\\^A": "Â", "\\~A": "Ã",
      "\\`{E}": "È", "\\'{E}": "É", "\\\"{E}": "Ë", "\\^{E}": "Ê",
      "\\`E": "È", "\\'E": "É", "\\\"E": "Ë", "\\^E": "Ê",
      "\\`{I}": "Ì", "\\'{I}": "Í", "\\\"{I}": "Ï", "\\^{I}": "Î",
      "\\`I": "Ì", "\\'I": "Í", "\\\"I": "Ï", "\\^I": "Î",
      "\\`{O}": "Ò", "\\'{O}": "Ó", "\\\"{O}": "Ö", "\\^{O}": "Ô", "\\~{O}": "Õ",
      "\\`O": "Ò", "\\'O": "Ó", "\\\"O": "Ö", "\\^O": "Ô", "\\~O": "Õ",
      "\\~{n}": "ñ", "\\~n": "ñ", "\\~{N}": "Ñ", "\\~N": "Ñ",

      // Additional accented characters
      "\\c{c}": "ç", "\\c{C}": "Ç",
      "\\u{a}": "ă", "\\u{A}": "Ă", "\\u{g}": "ğ", "\\u{G}": "Ğ",
      "\\v{c}": "č", "\\v{C}": "Č", "\\v{s}": "š", "\\v{S}": "Š",
      "\\v{z}": "ž", "\\v{Z}": "Ž",
      "\\H{u}": "ű", "\\H{U}": "Ű", "\\H{o}": "ő", "\\H{O}": "Ő",
      "\\k{a}": "ą", "\\k{A}": "Ą", "\\k{e}": "ę", "\\k{E}": "Ę",
      "\\l{}": "ł", "\\L{}": "Ł",
      "\\o{}": "ø", "\\O{}": "Ø",
      "\\ss{}": "ß",

      // Greek letters
      "\\alpha": "α", "\\beta": "β", "\\gamma": "γ", "\\delta": "δ", "\\epsilon": "ε",
      "\\zeta": "ζ", "\\eta": "η", "\\theta": "θ", "\\iota": "ι", "\\kappa": "κ",
      "\\lambda": "λ", "\\mu": "μ", "\\nu": "ν", "\\xi": "ξ", "\\omicron": "ο",
      "\\pi": "π", "\\rho": "ρ", "\\sigma": "σ", "\\tau": "τ", "\\upsilon": "υ",
      "\\phi": "φ", "\\chi": "χ", "\\psi": "ψ", "\\omega": "ω",
      "\\Alpha": "Α", "\\Beta": "Β", "\\Gamma": "Γ", "\\Delta": "Δ", "\\Epsilon": "Ε",
      "\\Zeta": "Ζ", "\\Eta": "Η", "\\Theta": "Θ", "\\Iota": "Ι", "\\Kappa": "Κ",
      "\\Lambda": "Λ", "\\Mu": "Μ", "\\Nu": "Ν", "\\Xi": "Ξ", "\\Omicron": "Ο",
      "\\Pi": "Π", "\\Rho": "Ρ", "\\Sigma": "Σ", "\\Tau": "Τ", "\\Upsilon": "Υ",
      "\\Phi": "Φ", "\\Chi": "Χ", "\\Psi": "Ψ", "\\Omega": "Ω",

      // Math symbols
      "\\int": "∫", "\\sum": "∑", "\\prod": "∏", "\\sqrt": "√", "\\infty": "∞",
      "\\partial": "∂", "\\nabla": "∇", "\\approx": "≈", "\\neq": "≠", "\\leq": "≤",
      "\\geq": "≥", "\\times": "×", "\\div": "÷", "\\pm": "±", "\\mp": "∓",
      "\\cdot": "⋅", "\\circ": "∘", "\\bullet": "•", "\\oplus": "⊕", "\\otimes": "⊗",
      "\\cup": "∪", "\\cap": "∩", "\\subset": "⊂", "\\supset": "⊃", "\\subseteq": "⊆",
      "\\supseteq": "⊇", "\\setminus": "∖", "\\forall": "∀", "\\exists": "∃", "\\neg": "¬",
      "\\land": "∧", "\\lor": "∨", "\\rightarrow": "→", "\\leftarrow": "←", "\\Rightarrow": "⇒",
      "\\Leftarrow": "⇐", "\\leftrightarrow": "↔", "\\Leftrightarrow": "⇔",
      "\\rangle": "⟩", "\\langle": "⟨", "\\oint": "∮", "\\otimes": "⊗", "\\partial": "∂",

      // Other symbols
      "\\mathbf{A}": "𝐀", "\\mathbf{B}": "𝐁", "\\mathbf{C}": "𝐂", "\\mathbf{D}": "𝐃", "\\mathbf{E}": "𝐄",
      "\\mathbf{F}": "𝐅", "\\mathbf{G}": "𝐆", "\\mathbf{H}": "𝐇", "\\mathbf{I}": "𝐈", "\\mathbf{J}": "𝐉",
      "\\mathbf{K}": "𝐊", "\\mathbf{L}": "𝐋", "\\mathbf{M}": "𝐌", "\\mathbf{N}": "𝐍", "\\mathbf{O}": "𝐎",
      "\\mathbf{P}": "𝐏", "\\mathbf{Q}": "𝐐", "\\mathbf{R}": "𝐑", "\\mathbf{S}": "𝐒", "\\mathbf{T}": "𝐓",
      "\\mathbf{U}": "𝐔", "\\mathbf{V}": "𝐕", "\\mathbf{W}": "𝐖", "\\mathbf{X}": "𝐗", "\\mathbf{Y}": "𝐘",
      "\\mathbf{Z}": "𝐙",
      "\\mathcal{A}": "𝒜", "\\mathcal{B}": "ℬ", "\\mathcal{C}": "𝒞", "\\mathcal{D}": "𝒟", "\\mathcal{E}": "ℰ",
      "\\mathcal{F}": "ℱ", "\\mathcal{G}": "𝒢", "\\mathcal{H}": "ℋ", "\\mathcal{I}": "ℐ", "\\mathcal{J}": "𝒥",
      "\\mathcal{K}": "𝒦", "\\mathcal{L}": "ℒ", "\\mathcal{M}": "ℳ", "\\mathcal{N}": "𝒩", "\\mathcal{O}": "𝒪",
      "\\mathcal{P}": "𝒫", "\\mathcal{Q}": "𝒬", "\\mathcal{R}": "ℛ", "\\mathcal{S}": "𝒮", "\\mathcal{T}": "𝒯",
      "\\mathcal{U}": "𝒰", "\\mathcal{V}": "𝒱", "\\mathcal{W}": "𝒲", "\\mathcal{X}": "𝒳", "\\mathcal{Y}": "𝒴",
      "\\mathcal{Z}": "𝒵"
  };

  // let latex_string_new = latex_string;
  // Replace LaTeX in the input string
  // for (const [latex, utf8] of Object.entries(latex2utf8)) {
  //   latex_string_new = latex_string_new.replace(new RegExp(latex, 'g'), utf8);
  // }

  // Escape LaTeX commands for regex
  const escapedKeys = Object.keys(latex2utf8).map(key =>
      key.replace(/[-[\]/{}()*+?.\\^$|]/g, '\\$&') // Escape special regex characters
  );
  // Create a regex pattern that matches any LaTeX command
  const regex = new RegExp(escapedKeys.join('|'), 'g');
  // Replace LaTeX commands with their UTF-8 equivalents
  latex_string_new = latex_string.replace(regex, match => latex2utf8[match]);

  return latex_string_new;
}

module.exports = getBibtexFromDOI;
  