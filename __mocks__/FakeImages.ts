import * as THREE from 'three';
import { Images } from '../src/editor/Images';

export class FakeImages extends Images {
    async add(name: string, data: Uint8Array): Promise<THREE.Texture> {
        return new THREE.Texture();
    }
    get(name: string): THREE.Texture {
        const img = jest.fn();
        return new THREE.Texture(img);
    }
    data(name: string): Uint8Array | undefined {
        return undefined;
    }
    clear(): void {
    }
    get names(): IterableIterator<string> {
        throw new Error('Method not implemented.');
    }
}
