let currentSection = 0;
const sections = document.querySelectorAll('.full-screen-div');
const totalSections = sections.length;

function scrollToSection(index) {
    if (index >= 0 && index < totalSections) {
        currentSection = index;
        sections[currentSection].scrollIntoView({ behavior: 'smooth' });
    }
}

window.addEventListener('wheel', (event) => {
    if (event.deltaY > 0) {
        scrollToSection(currentSection + 1);
    } else {
        scrollToSection(currentSection - 1);
    }
});

window.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
        scrollToSection(currentSection + 1);
    } else if (event.key === 'ArrowUp') {
        scrollToSection(currentSection - 1);
    }
});