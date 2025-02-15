import { Store } from 'pinia';
import { v4 as uuid } from 'uuid';
import { fileDialog } from 'file-select-dialog';
import { has, head, sortBy, debounce, startsWith, cloneDeep } from 'lodash';
import useCurrentTab from './useCurrentTab';
import useTemplateStore from './useTemplateStore';
import useProjectStoreFactory from './useProjectStoreFactory';
import { computed, ref, useContext, watch } from '@nuxtjs/composition-api';

export const namespace = 'pages/';

const getPagesFromStorage = () => {
    return Object.keys(window.localStorage).filter((key) => key.startsWith(namespace));
};

export default function () {
    const { $bus, $config } = useContext();

    const templates = useTemplateStore();

    const { currentTab, setTabFromProject } = useCurrentTab();

    const projects = ref([]);

    const canAddNewProject = computed(() => {
        return $config.isDesktop || projects.value.length < 2;
    });

    const canAddNewTemplate = computed(() => {
        return $config.isDesktop || templates.all().length < 3;
    });

    const currentProject = computed(() => {
        return findProjectByTabId(currentTab.value);
    });

    /**
     * Make a new project store.
     *
     * @param {String} id
     *
     * @returns {Store}
     */
    const makeProjectStore = (id = null) => {
        id = id ?? uuid();

        const name = startsWith(id, namespace) ? id : namespace + id;

        const factory = useProjectStoreFactory(name);

        const store = factory();

        store.load();

        store.$subscribe(debounce(store.sync, 2000));

        return store;
    };

    /**
     * Add a new project.
     *
     * @param {string|null} id
     *
     * @returns {Store|null}
     */
    const addNewProject = (id = null) => {
        if (!canAddNewProject.value) {
            $bus.$emit('alert', 'danger', 'Download the desktop app to unlock more tabs.');

            return;
        }

        const newProject = makeProjectStore(id);

        projects.value.push(newProject);

        setTabFromProject(newProject);

        return newProject;
    };

    /**
     * Attempt to import a new project from a JSON file.
     */
    const importNewProject = async () => {
        const files = await fileDialog({ accept: '.json' });

        const file = head(files);

        if (!file) {
            return;
        }

        const data = await new Response(file).json();

        ['tab', 'page', 'settings'].forEach((requiredKey) => {
            if (!has(data, requiredKey)) {
                $bus.$emit(
                    'alert',
                    'danger',
                    'Error importing configuration. Required data is missing.'
                );

                console.error(`The configuration file is missing the data key [${requiredKey}].`);
            }
        });

        const project = addNewProject();

        if (project) {
            project.$patch((state) => {
                state.page = data.page;
                state.settings = data.settings;
                state.tab.name = data.tab.name;
            });
        }
    };

    /**
     * Add a new project from the given template.
     *
     * @param {*} template
     *
     * @returns {Store}
     */
    const addProjectFromTemplate = (template) => {
        const data = cloneDeep(template);

        const project = addNewProject();

        if (project) {
            project.$patch((state) => {
                state.page = data.page;
                state.settings = data.settings;
                state.tab.name = data.tab.name;

                // Here we will port the old orientation setting,
                // so templates that were saved in an older
                // version can be restored properly.
                if (['portrait', 'landscape'].includes(state.page.orientation)) {
                    state.page.orientation = 'left';
                }
            });
        }
    };

    /**
     * Find a project by its tab ID.
     *
     * @param {String} tabId
     *
     * @returns {Store|null}
     */
    const findProjectByTabId = (tabId) => {
        return projects.value.find((project) => project.tab.id === tabId);
    };

    /**
     * Delete a project.
     *
     * @param {Store} project
     * @param {Number} index
     */
    const deleteProject = (project, index) => {
        project.clear();
        project.$dispose();

        projects.value.splice(index, 1);

        // prettier-ignore
        projects.value.length === 0
            ? addNewProject()
            : setTabFromProject(head(projects.value));
    };

    /**
     * Hydrate the projects from local storage.
     */
    const hydrateFromStorage = () => {
        const stored = getPagesFromStorage().map((id) => makeProjectStore(id));

        projects.value = sortBy(stored, ({ tab }) => tab.order ?? tab.created_at);
    };

    /**
     * Sync the project tab order when they have changed.
     */
    const syncTabOrder = debounce(() => {
        projects.value.map((project, index) => {
            project.$patch((state) => (state.tab.order = index));
        });
    }, 2500);

    return {
        projects,
        syncTabOrder,
        addNewProject,
        deleteProject,
        currentProject,
        importNewProject,
        canAddNewProject,
        canAddNewTemplate,
        findProjectByTabId,
        hydrateFromStorage,
        addProjectFromTemplate,
    };
}
