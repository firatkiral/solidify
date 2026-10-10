/**
 * @jest-environment jsdom
 */
import { Measure } from "../../src/command/MiniGizmos";
import { OffsetFaceDialog } from "../../src/commands/modifyface/OffsetFaceDialog";
import { OffsetFaceParams } from "../../src/commands/modifyface/OffsetFaceFactory";
import NumberScrubber from "../../src/components/dialog/NumberScrubber";
import Icon from "../../src/components/toolbar/Icon";
import { Editor } from "../../src/editor/Editor";

// A number field that shows a measure (see Measure) switches it with the icon in front of the number

let editor: Editor;

beforeAll(() => {
    editor = new Editor();
    NumberScrubber(editor);
    Icon(editor);
})

afterEach(() => { document.body.innerHTML = '' })

const scrubber = (attributes: Record<string, string>) => {
    const element = document.createElement('solidify-number-scrubber');
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
    document.body.append(element);
    return element;
}
const toggle = (element: Element) => element.querySelector('button');

describe('solidify-number-scrubber', () => {
    test('has no icon without a measure', () => {
        expect(toggle(scrubber({ name: 'distance', value: '1' }))).toBeNull();
    })

    test('the icon names the measure, and clicking it asks to switch without scrubbing', () => {
        const element = scrubber({ name: 'distance', value: '1', measure: 'Total' });
        const measure = jest.fn();
        element.addEventListener('measure', measure);
        const button = toggle(element)!;
        expect(button.getAttribute('aria-label')).toBe('Total, click to switch');
        expect((button.querySelector('solidify-icon') as any).name).toBe('measure-total');

        // Pressed and let go in place, the field would start typing; on the icon it doesn't
        button.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
        document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }));
        button.click();
        expect(measure).toHaveBeenCalledTimes(1);
        expect(element.querySelector('input')).toBeNull();
    })

    test('shows the offset icon in the accent colour', () => {
        const button = toggle(scrubber({ name: 'distance', value: '1', measure: 'Offset' }))!;
        expect(button.classList.contains('text-ui-accent')).toBe(true);
        expect((button.querySelector('solidify-icon') as any).name).toBe('measure-offset');
    })
})

describe(OffsetFaceDialog, () => {
    test('its distance shows the measure, takes it typed, and switches to the offset', () => {
        const params = { distance: 0, angle: 0, degrees: 0, faces: [] } as OffsetFaceParams;
        const measure = new Measure('Total', 30, 1);
        const dialog = new OffsetFaceDialog(params, 'automatic', editor.signals, () => measure);
        const cb = jest.fn();
        dialog.execute(cb);
        document.body.append(dialog);

        const distance = () => dialog.querySelector('solidify-number-scrubber[name="distance"]')!;
        expect(distance().getAttribute('value')).toBe('30');
        expect(distance().getAttribute('measure')).toBe('Total');

        // Typing a total of 50 offsets the face by 20
        distance().setAttribute('value', '50');
        distance().dispatchEvent(new Event('change'));
        expect(params.distance).toBe(20);
        expect(cb).toHaveBeenCalledWith(params);

        toggle(distance())!.click();
        expect(measure.offset).toBe(true);
        expect(distance().getAttribute('value')).toBe('20');
        expect(distance().getAttribute('measure')).toBe('Offset');
    })
})
